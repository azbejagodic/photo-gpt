const SERVER_APPLICATION = 'SnapOverLAN';
const SERVER_PROTOCOL_VERSION = 1;
const SERVER_CONTROL_ID = 'snapoverlan-server-control-v1';

const classifyServerStatus = (status) => {
  if (status?.status !== 'listening') {
    return 'unrelated';
  }
  if (status.application === SERVER_APPLICATION
    && status.protocolVersion === SERVER_PROTOCOL_VERSION) {
    return 'current';
  }
  if ('application' in status || 'protocolVersion' in status) {
    return 'unrelated';
  }
  if (Number.isInteger(status.pid)
    && status.pid > 0
    && typeof status.configuredHost === 'string'
    && typeof status.bindHost === 'string'
    && Number.isInteger(status.port)
    && Array.isArray(status.lanUrls)
    && typeof status.runtimeDataDir === 'string'
    && typeof status.latestDir === 'string'
    && typeof status.uploadTempDir === 'string') {
    return 'legacy';
  }
  return 'unrelated';
};

export {
  classifyServerStatus,
  SERVER_APPLICATION,
  SERVER_CONTROL_ID,
  SERVER_PROTOCOL_VERSION,
};
