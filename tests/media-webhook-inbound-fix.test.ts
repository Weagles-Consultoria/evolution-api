import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMediaMessageContent,
  getUnwrappedMediaMessage,
  optionalMediaUpload,
} from '../src/api/integrations/channel/whatsapp/media-message.utils';

const key = { id: 'media-regression-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false };

test('detects all supported direct media types', () => {
  for (const mediaType of [
    'imageMessage',
    'audioMessage',
    'videoMessage',
    'documentMessage',
    'stickerMessage',
    'ptvMessage',
  ]) {
    const message = { key, message: { [mediaType]: { mimetype: 'application/octet-stream', mediaKey: 'secret' } } };
    assert.equal(getMediaMessageContent(message)?.mediaType, mediaType);
  }
});

test('unwraps view-once media without mutating the Baileys message', () => {
  const message = {
    key,
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: { mimetype: 'image/jpeg', mediaKey: 'secret' },
        },
      },
      messageContextInfo: { messageSecret: 'opaque' },
    },
  };

  const original = structuredClone(message);
  const normalized = getUnwrappedMediaMessage(message);

  assert.equal(getMediaMessageContent(message)?.mediaType, 'imageMessage');
  assert.deepEqual(normalized.message.imageMessage, message.message.viewOnceMessageV2.message.imageMessage);
  assert.deepEqual(message, original);
});

test('does not treat messageContextInfo alone as media', () => {
  assert.equal(getMediaMessageContent({ key, message: { messageContextInfo: {} } }), null);
});

test('keeps the webhook continuation when S3 upload fails', async () => {
  const events: any[] = [];
  const payload = { key, message: { imageMessage: { mimetype: 'image/jpeg' } } };

  const mediaUrl = await optionalMediaUpload({
    buffer: Buffer.from('fixture'),
    fullName: 'instance/message/image/fixture.jpg',
    mimetype: 'image/jpeg',
    uploadFile: async () => {
      throw new Error('simulated S3 outage');
    },
    getObjectUrl: async () => 'https://s3.invalid/fixture.jpg',
    onError: () => undefined,
  });

  if (mediaUrl) {
    payload.message.mediaUrl = mediaUrl;
  }
  events.push(payload);

  assert.equal(mediaUrl, undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0].key.id, key.id);
  assert.equal(events[0].message.imageMessage.mimetype, 'image/jpeg');
});

test('keeps a mixed text/media batch continuous when media download is unavailable', () => {
  const batch = [
    { key: { ...key, id: 'text-1' }, message: { conversation: 'hello' } },
    { key: { ...key, id: 'image-1' }, message: { imageMessage: { mimetype: 'image/jpeg' } } },
    { key: { ...key, id: 'audio-1' }, message: { audioMessage: { mimetype: 'audio/ogg' } } },
  ];
  const events = batch.map((message) => ({
    key: message.key,
    messageType: getMediaMessageContent(message)?.mediaType || 'conversation',
  }));

  assert.deepEqual(
    events.map((event) => event.key.id),
    ['text-1', 'image-1', 'audio-1'],
  );
  assert.equal(events[1].messageType, 'imageMessage');
  assert.equal(events[2].messageType, 'audioMessage');
});
