import { config } from "../config";

export interface ConfigDefaults {
  delayBetweenEmailsSec: { min: number; max: number; default: number };
  hourlyLimit: { min: number; max: number; default: number };
}

/**
 * System defaults + hard bounds for the compose form (Assumption #5).
 * The delay floor is the env-configured minimum delay between sends; the
 * hourly-limit ceiling is the env-configured cap for the active mode.
 */
export function getConfigDefaults(): ConfigDefaults {
  const minDelaySec = Math.max(
    1,
    Math.round(config.scheduling.minDelayBetweenEmailsMs / 1000),
  );
  const effectiveHourlyCap =
    config.scheduling.rateLimitMode === "per_sender"
      ? config.scheduling.maxEmailsPerHourPerSender
      : config.scheduling.maxEmailsPerHour;

  return {
    delayBetweenEmailsSec: {
      min: minDelaySec,
      max: config.scheduling.maxDelayBetweenEmailsSec,
      default: minDelaySec,
    },
    hourlyLimit: {
      min: 1,
      max: effectiveHourlyCap,
      default: effectiveHourlyCap,
    },
  };
}
