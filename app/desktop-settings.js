const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  backgroundMode: false,
  autoCopyFirstPhoto: false,
});

const normalizeDesktopSettings = (value) => ({
  backgroundMode: value?.backgroundMode === true,
  autoCopyFirstPhoto: value?.autoCopyFirstPhoto === true,
});

const updateDesktopSetting = (settings, key, enabled) => {
  if (!Object.hasOwn(DEFAULT_DESKTOP_SETTINGS, key)) {
    throw new Error(`Unknown desktop setting: ${key}`);
  }

  return {
    ...normalizeDesktopSettings(settings),
    [key]: Boolean(enabled),
  };
};

export {
  DEFAULT_DESKTOP_SETTINGS,
  normalizeDesktopSettings,
  updateDesktopSetting,
};
