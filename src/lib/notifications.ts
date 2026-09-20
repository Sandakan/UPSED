import toast from 'react-hot-toast';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { EventLogRecord } from './types';
import i18n from './i18n';

/**
 * Mapping table of warning labels and rich user-facing explanations.
 * Covers both ViewPower protocol warning codes (a0-a69) and UPSED hardware transition events.
 */
export const EVENT_DETAILS: Record<
  string,
  { title: string; defaultDescription: string }
> = {
  // UPSED State Transition Events
  UTILITY_FAIL: {
    title: 'AC Utility Power Failure',
    defaultDescription:
      'Mains utility grid electricity lost. Inverter has automatically transferred to battery backup mode.',
  },
  UTILITY_RESTORE: {
    title: 'AC Utility Power Restored',
    defaultDescription:
      'Grid electricity returned to nominal range. UPS transferred back to normal line mode and resumed battery charging.',
  },
  BATTERY_LOW: {
    title: 'Low Battery Warning',
    defaultDescription:
      'Battery reserve capacity is critically low. Connected computers and devices should be shut down safely immediately.',
  },
  BATTERY_NORMAL: {
    title: 'Battery Reserve Normal',
    defaultDescription:
      'Battery voltage recovered above the critical low-voltage cutoff threshold.',
  },
  OVERLOAD: {
    title: 'UPS Output Overload Alarm',
    defaultDescription:
      'Connected power consumption exceeds 100% rated capacity. Disconnect non-critical loads to prevent immediate shutdown.',
  },
  OVERLOAD_CLEARED: {
    title: 'Output Load Normalized',
    defaultDescription:
      'Operating power demand returned within rated capacity boundaries.',
  },
  OVER_TEMP: {
    title: 'High Heatsink Temperature Warning',
    defaultDescription:
      'Internal inverter heatsink reached thermal warning limits. Verify cooling fan operation and ventilation airflow.',
  },
  TEMP_NORMAL: {
    title: 'Operating Temperature Normal',
    defaultDescription:
      'Internal unit temperatures returned to standard operating limits.',
  },
  BYPASS_ACTIVE: {
    title: 'Static Bypass Active',
    defaultDescription:
      'Load is running directly off unconditioned utility bypass line. Inverter protection is bypassed.',
  },
  BYPASS_CLEARED: {
    title: 'Conditioned Inverter Restored',
    defaultDescription:
      'Output safely transferred from static bypass back to conditioned PWM inverter power.',
  },
  UPS_FAULT: {
    title: 'UPS Hardware Fault Alarm',
    defaultDescription:
      'Internal hardware failure or power bus abnormality detected by inverter processor.',
  },
  CONNECT: {
    title: 'UPS Communication Established',
    defaultDescription:
      'Hardware communication link established with local controller.',
  },
  DISCONNECT: {
    title: 'UPS Communication Disconnected',
    defaultDescription:
      'Communication link to the UPS port closed or disconnected.',
  },
  CONNECT_ERROR: {
    title: 'UPS Connection Failure',
    defaultDescription:
      'Failed to open serial or USB HID transport to the designated port.',
  },
  POLL_ERROR: {
    title: 'Telemetry Polling Error',
    defaultDescription:
      'Hardware telemetry query timed out or returned corrupted response packet.',
  },

  // ViewPower Warning Code mappings (QPIWS a0-a69)
  'warning.a0': {
    title: 'Battery Disconnected',
    defaultDescription:
      'Battery circuit breaker is open or battery terminals are disconnected. Check battery cabling.',
  },
  'warning.a1': {
    title: 'Neutral Line Disconnected',
    defaultDescription:
      'Neutral wire is not detected at input terminals. Check AC wiring polarity.',
  },
  'warning.a2': {
    title: 'Site Wiring Fault',
    defaultDescription:
      'Ground wire or neutral line reverse phase detected at building outlet.',
  },
  'warning.a3': {
    title: 'Phase Sequence Incorrect',
    defaultDescription:
      'Input AC supply three-phase rotation direction is reversed.',
  },
  'warning.a4': {
    title: 'Bypass Phase Sequence Incorrect',
    defaultDescription:
      'Bypass line input phase rotation does not match primary input.',
  },
  'warning.a5': {
    title: 'Input Frequency Unstable in Bypass',
    defaultDescription:
      'Grid frequency fluctuation exceeds synchronized tracking limits.',
  },
  'warning.a6': {
    title: 'Battery Overcharged',
    defaultDescription:
      'Battery float voltage exceeds permissible high threshold. Charger halted.',
  },
  'warning.a7': {
    title: 'Low Battery',
    defaultDescription:
      'Battery energy level low. Operating time is limited.',
  },
  'warning.a8': {
    title: 'Output Overload',
    defaultDescription:
      'Total appliance power draw exceeds continuous rating of inverter.',
  },
  'warning.a9': {
    title: 'Cooling Fan Alarm',
    defaultDescription:
      'Cooling fan speed is abnormal or fan is locked by foreign object.',
  },
  'warning.a10': {
    title: 'Emergency Power Off (EPO) Activated',
    defaultDescription:
      'Hardware emergency power cut switch engaged. Inverter output disabled.',
  },
  'warning.a11': {
    title: 'Abnormal Power Turn On',
    defaultDescription:
      'Inverter power-up sequence failed to establish stable bus voltage.',
  },
  'warning.a12': {
    title: 'Over Temperature Alarm',
    defaultDescription:
      'Thermal sensors report dangerous heatsink or ambient temperatures.',
  },
  'warning.a13': {
    title: 'Battery Charger Alarm',
    defaultDescription:
      'Internal charging circuit malfunctioned. Batteries cannot recharge.',
  },
  'warning.a14': {
    title: 'Remote Auto Shutdown Initiated',
    defaultDescription:
      'Remote command or automated shutdown countdown triggered on UPS.',
  },
  'warning.a55': {
    title: 'Battery Replacement Required',
    defaultDescription:
      'Battery internal resistance test failed. Battery pack aged and needs replacement.',
  },
  'warning.a60': {
    title: 'Bypass Unstable',
    defaultDescription:
      'Static bypass line AC voltage or frequency outside safe bypass transfer window.',
  },
  'warning.a69': {
    title: 'Battery Self-Test Failed',
    defaultDescription:
      '10-second battery discharge test failed to sustain load voltage.',
  },
};

/**
 * Resolves user-friendly title and detailed description for any event or warning.
 */
export function getEventInfo(event: EventLogRecord): {
  title: string;
  description: string;
} {
  const i18nKey = `notifications:${event.event_type}`;
  if (i18n.exists(`${i18nKey}.title`)) {
    const title = (i18n.t as any)(`${i18nKey}.title`) as string;
    const defaultDesc = (i18n.t as any)(`${i18nKey}.description`) as string;
    const desc =
      event.message && !event.message.startsWith(title)
        ? event.message
        : defaultDesc;
    return {
      title,
      description: desc,
    };
  }

  const match = EVENT_DETAILS[event.event_type];
  if (match) {
    const desc =
      event.message && !event.message.startsWith(match.title)
        ? event.message
        : match.defaultDescription;
    return {
      title: match.title,
      description: desc,
    };
  }

  const formattedTitle = event.event_type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    title: formattedTitle,
    description: event.message || i18n.t('notifications:defaultHardwareEvent', 'Hardware event reported by UPS.'),
  };
}

/**
 * Handles an incoming UPS event:
 * 1. Checks if OS notifications are allowed and if window is unfocused -> triggers OS notification
 * 2. Displays bespoke custom toast in-app via react-hot-toast
 */
export async function handleIncomingUpsEvent(
  event: EventLogRecord,
  options?: {
    osNotificationsEnabled?: boolean;
    inAppToastsEnabled?: boolean;
  }
) {
  const osAllowed = options?.osNotificationsEnabled ?? true;
  const inAppAllowed = options?.inAppToastsEnabled ?? true;

  const { title, description } = getEventInfo(event);

  // Check if window is in focus
  const isWindowFocused =
    typeof document !== 'undefined' && document.hasFocus();

  // If app is not in focus (or minimized/tray), dispatch native OS notification
  if (!isWindowFocused && osAllowed) {
    try {
      let permitted = await isPermissionGranted();
      if (!permitted) {
        const permission = await requestPermission();
        permitted = permission === 'granted';
      }

      if (permitted) {
        sendNotification({
          title: `UPSED: ${title}`,
          body: `${description} (${event.port_name})`,
        });
      }
    } catch (err) {
      console.warn('Native notification failed:', err);
    }
  }

  // Always show in-app toast if inAppToastsEnabled is true
  if (inAppAllowed) {
    // Dispatched to custom headless toaster
    toast.custom(
      () =>
        JSON.stringify({
          event,
          title,
          description,
        }),
      {
        duration:
          event.severity === 'critical'
            ? 12000
            : event.severity === 'warning'
            ? 8000
            : 5000,
        id: `${event.event_type}-${event.timestamp}`,
      }
    );
  }
}
