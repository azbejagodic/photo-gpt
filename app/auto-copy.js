import path from 'path';

const UPLOAD_COMPLETED_EVENT = 'snapoverlan:upload-completed';

const validateUploadCompletedMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  if (message.type !== UPLOAD_COMPLETED_EVENT) {
    return null;
  }

  const batchId = typeof message.batchId === 'string' ? message.batchId.trim() : '';
  const firstImage = message.firstImage;
  if (!batchId || batchId.length > 256 || !firstImage || typeof firstImage !== 'object') {
    return null;
  }

  const name = typeof firstImage.name === 'string' ? firstImage.name.trim() : '';
  const filePath = typeof firstImage.path === 'string' ? firstImage.path.trim() : '';
  const mimeType = typeof firstImage.mimeType === 'string' ? firstImage.mimeType.trim() : '';
  if (
    !name
    || name.length > 512
    || name !== path.basename(name)
    || !path.isAbsolute(filePath)
    || !mimeType.startsWith('image/')
  ) {
    return null;
  }

  return {
    type: UPLOAD_COMPLETED_EVENT,
    batchId,
    firstImage: {
      name,
      path: filePath,
      mimeType,
    },
  };
};

const copyFirstUploadedImage = async ({
  message,
  enabled,
  fileExists,
  createImageFromPath,
  writeImage,
}) => {
  if (!enabled) {
    return { status: 'disabled' };
  }

  const event = validateUploadCompletedMessage(message);
  if (!event) {
    return { status: 'ignored' };
  }

  const { name, path: filePath } = event.firstImage;
  try {
    if (!(await fileExists(filePath))) {
      throw new Error('The uploaded image is no longer available.');
    }

    const image = createImageFromPath(filePath);
    if (!image || typeof image.isEmpty !== 'function' || image.isEmpty()) {
      throw new Error('Electron could not decode the uploaded image.');
    }

    writeImage(image);
    return {
      status: 'copied',
      filename: name,
      batchId: event.batchId,
    };
  } catch (error) {
    return {
      status: 'failed',
      filename: name,
      batchId: event.batchId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export {
  UPLOAD_COMPLETED_EVENT,
  copyFirstUploadedImage,
  validateUploadCompletedMessage,
};
