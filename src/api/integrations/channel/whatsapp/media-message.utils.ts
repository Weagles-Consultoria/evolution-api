import { MessageSubtype, TypeMediaMessage } from '@api/types/wa.types';

export type MediaMessageContent = {
  content: any;
  mediaType: string;
};

/**
 * Finds media below the wrappers Baileys uses for ephemeral and view-once
 * messages without changing the message received from Baileys.
 */
export function getMediaMessageContent(message: any): MediaMessageContent | null {
  let content = message?.message ?? message;

  for (let depth = 0; content && depth <= MessageSubtype.length; depth++) {
    const mediaType = TypeMediaMessage.find((type) => content[type] && Object.keys(content[type]).length > 0);

    if (mediaType) {
      return { content, mediaType };
    }

    const template = content.templateMessage?.hydratedTemplate || content.templateMessage?.hydratedFourRowTemplate;
    const templateMediaType = TypeMediaMessage.find((type) => template?.[type]);
    if (templateMediaType) {
      return {
        content: {
          [templateMediaType]: { ...template[templateMediaType], url: template[templateMediaType].staticUrl },
        },
        mediaType: templateMediaType,
      };
    }

    const subtype = MessageSubtype.find((type) => content[type]?.message);
    if (!subtype) {
      break;
    }

    content = content[subtype].message;
  }

  return null;
}

/**
 * Creates the envelope used by Baileys download helpers with only the
 * unwrapped media content. The original envelope and nested objects remain
 * untouched so it can still be used for webhook/database processing.
 */
export function getUnwrappedMediaMessage(message: any): any | null {
  const media = getMediaMessageContent(message);
  if (!media || !message) {
    return null;
  }

  return {
    ...message,
    message: { ...media.content },
  };
}

export async function optionalMediaUpload(options: {
  buffer: Buffer;
  fullName: string;
  mimetype: string;
  uploadFile: (fullName: string, buffer: Buffer, size: number, metadata: { 'Content-Type': string }) => Promise<any>;
  getObjectUrl: (fullName: string) => Promise<string>;
  onError: (stage: 'upload' | 'url', error: any) => void;
}): Promise<string | undefined> {
  try {
    const uploadResult = await options.uploadFile(options.fullName, options.buffer, options.buffer.length, {
      'Content-Type': options.mimetype,
    });

    if (uploadResult instanceof Error) {
      throw uploadResult;
    }
  } catch (error) {
    options.onError('upload', error);
    return undefined;
  }

  try {
    return await options.getObjectUrl(options.fullName);
  } catch (error) {
    options.onError('url', error);
    return undefined;
  }
}
