import { useState, useEffect, useMemo, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery,
  Clock,
  Shield,
  Save,
  Check,
  Zap,
  Bell,
  Monitor,
  Sun,
  Moon,
  AlertTriangle,
  Languages,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  Activity,
  Star,
  Trash2,
  Cpu,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { api } from '../lib/tauri';
import { UpsMetadata, ThemeMode } from '../lib/types';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  calculateActiveWatts,
  BatteryChemistry,
} from '../lib/battery';
import { getAppLanguageMode, setAppLanguage, AppLanguageMode } from '../lib/i18n';

export interface SettingsHandle {
  save: () => Promise<boolean>;
  discard: () => void;
}

export interface SettingsProps {
  pollInterval: number;
  onPollIntervalChange: (val: number) => void;
  batteryBridgeActive: boolean;
  onBatteryBridgeChange: (val: boolean) => void;
  metadata?: UpsMetadata | null;
  onUpdateMetadata?: (val: UpsMetadata) => void;
  profiles?: UpsMetadata[];
  onSelectUps?: (upsId: string) => void;
  onProfilesChanged?: () => void;
  osNotificationsEnabled: boolean;
  onOsNotificationsChange: (val: boolean) => void;
  inAppToastsEnabled: boolean;
  onInAppToastsChange: (val: boolean) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  showOutageHighlights?: boolean;
  onShowOutageHighlightsChange?: (val: boolean) => void;
  downsamplingMaxPoints?: number;
  onDownsamplingMaxPointsChange?: (val: number) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onOpenAbout?: () => void;
}

interface PersistedSettings {
  theme: ThemeMode;
  lang: AppLanguageMode;
  interval: number;
  bridge: boolean;
  autostart: boolean;
  startMinimized: boolean;
  closeToMinimize: boolean;
  osNotif: boolean;
  inAppToast: boolean;
  outageHighlights: boolean;
  downsamplingMaxPoints: number;
  upsName: string;
  ratedVa: number;
  powerFactor: number;
  batteryVoltage: number;
  batteryCapacityAh: number;
  batteryChemistry: BatteryChemistry;
  topology: string;
}

export const Settings = forwardRef<SettingsHandle, SettingsProps>(
  (
    {
      pollInterval,
      onPollIntervalChange,
      batteryBridgeActive,
      onBatteryBridgeChange,
      metadata,
      onUpdateMetadata,
      profiles = [],
      onSelectUps,
      onProfilesChanged,
      osNotificationsEnabled,
      onOsNotificationsChange,
      inAppToastsEnabled,
      onInAppToastsChange,
      themeMode,
      onThemeModeChange,
      showOutageHighlights = true,
      onShowOutageHighlightsChange,
      downsamplingMaxPoints = 5000,
      onDownsamplingMaxPointsChange,
      onDirtyChange,
      onOpenAbout,
    },
    ref
  ) => {
    const { t } = useTranslation(['settings', 'common']);
    const [currentTheme, setCurrentTheme] = useState<ThemeMode>(themeMode);
    const [currentLangMode, setCurrentLangMode] = useState<AppLanguageMode>(getAppLanguageMode());
    const [intervalVal, setIntervalVal] = useState(pollInterval);
    const [bridgeVal, setBridgeVal] = useState(batteryBridgeActive);
    const [osNotifVal, setOsNotifVal] = useState(osNotificationsEnabled);
    const [inAppToastVal, setInAppToastVal] = useState(inAppToastsEnabled);
    const [outageHighlightsVal, setOutageHighlightsVal] = useState<boolean>(showOutageHighlights);
    const [downsamplingVal, setDownsamplingVal] = useState<number>(downsamplingMaxPoints);
    const [autostartVal, setAutostartVal] = useState(false);
    const [startMinimizedVal, setStartMinimizedVal] = useState(true);
    const [closeToMinimizeVal, setCloseToMinimizeVal] = useState(true);
    const [savedNotice, setSavedNotice] = useState(false);
    const [isDev, setIsDev] = useState<boolean>(import.meta.env.DEV);
    const [isSaving, setIsSaving] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [persisted, setPersisted] = useState<PersistedSettings | null>(null);

    // UPS Profile state
    const [upsName, setUpsName] = useState(metadata?.name || 'Connected UPS');
    const [ratedVa, setRatedVa] = useState(metadata?.rated_va || 1000);
    const [powerFactor, setPowerFactor] = useState(metadata?.power_factor || 0.8);
    const [batteryVoltage, setBatteryVoltage] = useState(metadata?.battery_voltage || 24);
    const [batteryCapacityAh, setBatteryCapacityAh] = useState(metadata?.battery_capacity_ah || 9.0);
    const [batteryChemistry, setBatteryChemistry] = useState<BatteryChemistry>(
      (metadata?.battery_chemistry as BatteryChemistry) || 'VRLA_SLA'
    );
    const [topology, setTopology] = useState(metadata?.topology || 'Online');

    useEffect(() => {
      setCurrentTheme(themeMode);
    }, [themeMode]);

    useEffect(() => {
      let isMounted = true;
      Promise.all([
        api.isDevMode().catch(() => import.meta.env.DEV),
        isAutostartEnabled().catch(() => false),
        api.getCloseToMinimize().catch(() => true),
        api.getStartMinimized().catch(() => true),
      ]).then(([devMode, autostart, closeToMin, startMin]) => {
        if (!isMounted) return;
        setIsDev(devMode);
        setAutostartVal(autostart);
        setCloseToMinimizeVal(closeToMin);
        setStartMinimizedVal(startMin);

        const initial: PersistedSettings = {
          theme: themeMode,
          lang: getAppLanguageMode(),
          interval: pollInterval,
          bridge: batteryBridgeActive,
          autostart,
          startMinimized: startMin,
          closeToMinimize: closeToMin,
          osNotif: osNotificationsEnabled,
          inAppToast: inAppToastsEnabled,
          outageHighlights: showOutageHighlights,
          downsamplingMaxPoints,
          upsName: metadata?.name || 'Connected UPS',
          ratedVa: metadata?.rated_va || 1000,
          powerFactor: metadata?.power_factor || 0.8,
          batteryVoltage: metadata?.battery_voltage || 24,
          batteryCapacityAh: metadata?.battery_capacity_ah || 9.0,
          batteryChemistry: (metadata?.battery_chemistry as BatteryChemistry) || 'VRLA_SLA',
          topology: metadata?.topology || 'Online',
        };
        setPersisted(initial);
        setIsInitialLoading(false);
      });

      return () => {
        isMounted = false;
      };
    }, []);

    useEffect(() => {
      if (metadata) {
        setUpsName(metadata.name);
        setRatedVa(metadata.rated_va);
        setPowerFactor(metadata.power_factor || 0.8);
        setBatteryVoltage(metadata.battery_voltage);
        setBatteryCapacityAh(metadata.battery_capacity_ah);
        setBatteryChemistry((metadata.battery_chemistry as BatteryChemistry) || 'VRLA_SLA');
        setTopology(metadata.topology || 'Online');

        setPersisted((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            upsName: metadata.name,
            ratedVa: metadata.rated_va,
            powerFactor: metadata.power_factor || 0.8,
            batteryVoltage: metadata.battery_voltage,
            batteryCapacityAh: metadata.battery_capacity_ah,
            batteryChemistry: (metadata.battery_chemistry as BatteryChemistry) || 'VRLA_SLA',
            topology: metadata.topology || 'Online',
          };
        });
      }
    }, [metadata]);

    const derivedWatts = calculateActiveWatts(ratedVa, powerFactor);

    const hasUnsavedChanges = useMemo(() => {
      if (isInitialLoading || !persisted) return false;
      const isBasicDirty =
        currentTheme !== persisted.theme ||
        currentLangMode !== persisted.lang ||
        intervalVal !== persisted.interval ||
        bridgeVal !== persisted.bridge ||
        autostartVal !== persisted.autostart ||
        startMinimizedVal !== persisted.startMinimized ||
        closeToMinimizeVal !== persisted.closeToMinimize ||
        osNotifVal !== persisted.osNotif ||
        inAppToastVal !== persisted.inAppToast ||
        outageHighlightsVal !== persisted.outageHighlights ||
        downsamplingVal !== persisted.downsamplingMaxPoints;

      if (isBasicDirty) return true;

      if (metadata) {
        const isProfileDirty =
          upsName.trim() !== persisted.upsName.trim() ||
          Number(ratedVa) !== Number(persisted.ratedVa) ||
          Number(powerFactor) !== Number(persisted.powerFactor) ||
          Number(batteryVoltage) !== Number(persisted.batteryVoltage) ||
          Number(batteryCapacityAh) !== Number(persisted.batteryCapacityAh) ||
          batteryChemistry !== persisted.batteryChemistry ||
          topology !== persisted.topology;
        if (isProfileDirty) return true;
      }

      return false;
    }, [
      isInitialLoading,
      persisted,
      currentTheme,
      currentLangMode,
      intervalVal,
      bridgeVal,
      autostartVal,
      startMinimizedVal,
      closeToMinimizeVal,
      osNotifVal,
      inAppToastVal,
      outageHighlightsVal,
      downsamplingVal,
      metadata,
      upsName,
      ratedVa,
      powerFactor,
      batteryVoltage,
      batteryCapacityAh,
      batteryChemistry,
      topology,
    ]);

    useEffect(() => {
      onDirtyChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onDirtyChange]);

    const handleDiscard = useCallback(() => {
      if (!persisted) return;
      setCurrentTheme(persisted.theme);
      onThemeModeChange(persisted.theme);
      setCurrentLangMode(persisted.lang);
      setAppLanguage(persisted.lang);
      setIntervalVal(persisted.interval);
      setBridgeVal(persisted.bridge);
      setAutostartVal(persisted.autostart);
      setStartMinimizedVal(persisted.startMinimized);
      setCloseToMinimizeVal(persisted.closeToMinimize);
      setOsNotifVal(persisted.osNotif);
      setInAppToastVal(persisted.inAppToast);
      setOutageHighlightsVal(persisted.outageHighlights);
      setDownsamplingVal(persisted.downsamplingMaxPoints);
      setUpsName(persisted.upsName);
      setRatedVa(persisted.ratedVa);
      setPowerFactor(persisted.powerFactor);
      setBatteryVoltage(persisted.batteryVoltage);
      setBatteryCapacityAh(persisted.batteryCapacityAh);
      setBatteryChemistry(persisted.batteryChemistry);
      setTopology(persisted.topology);
    }, [persisted, onThemeModeChange]);

    const handleSave = useCallback(async (): Promise<boolean> => {
      setIsSaving(true);
      try {
        onPollIntervalChange(intervalVal);
        onBatteryBridgeChange(bridgeVal);
        onOsNotificationsChange(osNotifVal);
        onInAppToastsChange(inAppToastVal);
        onShowOutageHighlightsChange?.(outageHighlightsVal);
        onDownsamplingMaxPointsChange?.(downsamplingVal);
        onThemeModeChange(currentTheme);

        await api.setBatteryBridgeStatus(bridgeVal);
        await api.setCloseToMinimize(closeToMinimizeVal);
        await api.setStartMinimized(startMinimizedVal);
        await api.setTheme(currentTheme);

        if (!isDev) {
          if (autostartVal) {
            await enableAutostart();
          } else {
            await disableAutostart();
          }
        }

        if (metadata) {
          const updatedMeta: UpsMetadata = {
            ...metadata,
            name: upsName.trim() || 'Connected UPS',
            rated_va: Math.max(50, Number(ratedVa)),
            power_factor: Number(powerFactor),
            rated_watts: derivedWatts,
            battery_voltage: Number(batteryVoltage),
            battery_capacity_ah: Number(batteryCapacityAh),
            battery_chemistry: batteryChemistry,
            topology,
            updated_at: new Date().toISOString(),
          };
          await api.saveUpsMetadata(updatedMeta);
          onUpdateMetadata?.(updatedMeta);
        }

        setPersisted({
          theme: currentTheme,
          lang: currentLangMode,
          interval: intervalVal,
          bridge: bridgeVal,
          autostart: autostartVal,
          startMinimized: startMinimizedVal,
          closeToMinimize: closeToMinimizeVal,
          osNotif: osNotifVal,
          inAppToast: inAppToastVal,
          outageHighlights: outageHighlightsVal,
          downsamplingMaxPoints: downsamplingVal,
          upsName: upsName.trim() || 'Connected UPS',
          ratedVa: Math.max(50, Number(ratedVa)),
          powerFactor: Number(powerFactor),
          batteryVoltage: Number(batteryVoltage),
          batteryCapacityAh: Number(batteryCapacityAh),
          batteryChemistry,
          topology,
        });

        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2500);

        return true;
      } catch (e: any) {
        console.error('Failed to save settings:', e);
        toast.custom(
          JSON.stringify({
            title: t('settings:toasts.saveErrorTitle', 'Save Failed'),
            description: t('settings:toasts.saveError', 'Failed to save settings: {{error}}', {
              error: e?.message || String(e),
            }),
            event: {
              severity: 'critical',
              event_type: 'SETTINGS_ERROR',
              timestamp: new Date().toISOString(),
            },
          })
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    }, [
      intervalVal,
      bridgeVal,
      osNotifVal,
      inAppToastVal,
      outageHighlightsVal,
      downsamplingVal,
      currentTheme,
      onPollIntervalChange,
      onBatteryBridgeChange,
      onOsNotificationsChange,
      onInAppToastsChange,
      onShowOutageHighlightsChange,
      onDownsamplingMaxPointsChange,
      onThemeModeChange,
      closeToMinimizeVal,
      startMinimizedVal,
      isDev,
      autostartVal,
      metadata,
      upsName,
      ratedVa,
      powerFactor,
      derivedWatts,
      batteryVoltage,
      batteryCapacityAh,
      batteryChemistry,
      topology,
      onUpdateMetadata,
      currentLangMode,
      t,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        save: handleSave,
        discard: handleDiscard,
      }),
      [handleSave, handleDiscard]
    );

    const handleLanguageChange = (mode: AppLanguageMode) => {
      setCurrentLangMode(mode);
      setAppLanguage(mode);
    };

    return (
      <div className="relative p-3.5 sm:p-6 pb-4 sm:pb-6 space-y-4 sm:space-y-5 flex-1 h-full overflow-y-auto custom-scrollbar min-w-0">

      {/* ── 1. Appearance & Color Theme ─────────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-4"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Sun className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                {t('settings:themeSection.title', 'Appearance & Color Theme')}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings:themeSection.desc', 'Choose between dark, light, or automated OS preference syncing.')}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08]">
            {currentTheme === 'system' ? t('settings:themeSection.syncingOs', 'Syncing with OS') : t('settings:themeSection.modeLabel', { mode: currentTheme, defaultValue: `${currentTheme} mode` })}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {/* System Option */}
          <button
            type="button"
            onClick={() => {
              setCurrentTheme('system');
              onThemeModeChange('system');
            }}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentTheme === 'system'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Monitor className="w-4 h-4" />
              </div>
              {currentTheme === 'system' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:themeSection.systemTitle', 'System Default')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:themeSection.systemDesc', 'Matches Windows color scheme')}
              </p>
            </div>
          </button>

          {/* Dark Option */}
          <button
            type="button"
            onClick={() => {
              setCurrentTheme('dark');
              onThemeModeChange('dark');
            }}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentTheme === 'dark'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Moon className="w-4 h-4" />
              </div>
              {currentTheme === 'dark' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:themeSection.darkTitle', 'Dark Theme')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:themeSection.darkDesc', 'Obsidian & charcoal SaaS design')}
              </p>
            </div>
          </button>

          {/* Light Option */}
          <button
            type="button"
            onClick={() => {
              setCurrentTheme('light');
              onThemeModeChange('light');
            }}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentTheme === 'light'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Sun className="w-4 h-4" />
              </div>
              {currentTheme === 'light' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:themeSection.lightTitle', 'Light Theme')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:themeSection.lightDesc', 'Crisp high-contrast daylight design')}
              </p>
            </div>
          </button>
        </div>

        {/* Outage Highlights on Graphs Toggle */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <div>
            <p className="text-xs font-semibold text-slate-200">
              {t('settings:themeSection.outageHighlightsTitle', 'Highlight Power Outages on Graphs')}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('settings:themeSection.outageHighlightsDesc', 'Display shaded red background bands and indicators during power cuts and utility blackout intervals.')}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={outageHighlightsVal}
              onChange={(e) => setOutageHighlightsVal(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
          </label>
        </div>
      </div>

      {/* ── 2. Language & Localization ───────────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-4"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Languages className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                {t('settings:languageSection.title', 'Language & Localization')}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings:languageSection.desc', 'Select user interface language. Defaults to operating system display language.')}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08]">
            {currentLangMode === 'system' ? 'System' : currentLangMode.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {/* System Default Option */}
          <button
            type="button"
            onClick={() => handleLanguageChange('system')}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentLangMode === 'system'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Monitor className="w-4 h-4" />
              </div>
              {currentLangMode === 'system' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:themeSection.systemTitle', 'System Default')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:languageSection.systemDesc', 'Automatic based on Windows locale')}
              </p>
            </div>
          </button>

          {/* English Option */}
          <button
            type="button"
            onClick={() => handleLanguageChange('en')}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentLangMode === 'en'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300 font-bold text-xs">
                EN
              </div>
              {currentLangMode === 'en' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">English</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:languageSection.enDesc', 'English (US / International)')}
              </p>
            </div>
          </button>

          {/* Français Option */}
          <button
            type="button"
            onClick={() => handleLanguageChange('fr')}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentLangMode === 'fr'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300 font-bold text-xs">
                FR
              </div>
              {currentLangMode === 'fr' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Français</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:languageSection.frDesc', 'Français (French)')}
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* ── 3. UPS Profiles Management ──────────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-4"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                UPS Device Profiles Management
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage all registered UPS units, switch active profile view, set primary master device, or purge telemetry data.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08]">
            {profiles.length} Profiles
          </span>
        </div>

        <div className="space-y-3 pt-1">
          {profiles.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">
              No UPS profiles saved yet. Connect and configure a UPS device to populate this list.
            </p>
          ) : (
            profiles.map((p) => {
              const isCurrentActive = metadata?.unique_id === p.unique_id;
              return (
                <div
                  key={p.unique_id}
                  className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 transition ${
                    isCurrentActive
                      ? 'bg-cyan-950/20 border-cyan-500/40'
                      : 'bg-white/[0.02] border-white/[0.06]'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="font-semibold text-sm text-slate-100 truncate">
                        {p.name}
                      </span>
                      {p.is_primary && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                          <Star className="w-2.5 h-2.5 fill-amber-400" />
                          Primary
                        </span>
                      )}
                      {isCurrentActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          Active View
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-3 text-[11px] text-slate-400 font-mono flex-wrap">
                      <span>ID: {p.unique_id}</span>
                      {p.last_port && <span>Port: {p.last_port}</span>}
                      <span>{p.rated_va} VA ({p.rated_watts}W)</span>
                      <span>Poll: {p.poll_interval_secs ?? 10}s</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 flex-wrap gap-y-1">
                    {!isCurrentActive && onSelectUps && (
                      <button
                        type="button"
                        onClick={() => onSelectUps(p.unique_id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition cursor-pointer"
                      >
                        Select View
                      </button>
                    )}

                    {!p.is_primary && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.setPrimaryUps(p.unique_id);
                            toast.success(`Set ${p.name} as Primary Master UPS`);
                            onProfilesChanged?.();
                          } catch (e: any) {
                            toast.error(`Failed to set primary: ${e?.message || e}`);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition cursor-pointer"
                      >
                        Set Primary
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`Clear all telemetry history for "${p.name}"? This cannot be undone.`)) {
                          try {
                            const count = await api.clearTelemetry(p.unique_id);
                            toast.success(`Cleared ${count} telemetry records for ${p.name}`);
                          } catch (e: any) {
                            toast.error(`Failed to clear telemetry: ${e?.message || e}`);
                          }
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition cursor-pointer"
                    >
                      Clear History
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`Permanently delete UPS profile "${p.name}" (${p.unique_id})? All recorded telemetry and events for this device will be deleted!`)) {
                          try {
                            await api.deleteUpsProfile(p.unique_id);
                            toast.success(`Deleted profile ${p.name}`);
                            onProfilesChanged?.();
                          } catch (e: any) {
                            toast.error(`Failed to delete profile: ${e?.message || e}`);
                          }
                        }
                      }}
                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-800/40 transition cursor-pointer"
                      title="Delete Profile"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 4. Active UPS Profile & Specifications ───────────── */}
      {metadata && (
        <div
          className="rounded-2xl p-5 shadow-sm border transition space-y-4"
          style={{
            backgroundColor: 'var(--card-bg)',
            borderColor: 'var(--card-border)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5 text-slate-200">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-100">
                  {t('settings:profileSection.title', 'Active UPS Profile & Specifications')}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('settings:profileSection.desc', 'Calibrate hardware specifications to ensure precise runtime calculations and battery curves.')}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08]">
              ID: {metadata.unique_id}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('settings:profileSection.upsName', 'UPS Display Name')}
              </label>
              <input
                type="text"
                value={upsName}
                onChange={(e) => setUpsName(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('settings:profileSection.ratedVa', 'Rated Apparent Power (VA)')}
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="50"
                  max="100000"
                  step="50"
                  value={ratedVa}
                  onChange={(e) => setRatedVa(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
                />
                <span className="text-xs font-mono text-slate-400">VA</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('settings:profileSection.powerFactor', 'Power Factor (PF) & Active Power')}
              </label>
              <div className="flex items-center space-x-2">
                <select
                  value={powerFactor}
                  onChange={(e) => setPowerFactor(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
                >
                  <option value={0.6}>0.6 ({t('settings:profileSection.topologyLineInteractive', 'Desktop / Line-Interactive')})</option>
                  <option value={0.8}>0.8 (Business / Server Prosumer)</option>
                  <option value={0.9}>0.9 ({t('settings:profileSection.topologyOnline', 'Online Double-Conversion')})</option>
                  <option value={1.0}>1.0 (Enterprise Unity)</option>
                </select>
                <span className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                  = {derivedWatts}W
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('settings:profileSection.batteryChemistry', 'Battery Chemistry')}
              </label>
              <select
                value={batteryChemistry}
                onChange={(e) => setBatteryChemistry(e.target.value as BatteryChemistry)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
              >
                <option value="VRLA_SLA">{t('settings:profileSection.chemistryVrla', 'Standard Lead-Acid (VRLA / AGM)')}</option>
                <option value="GEL">{t('settings:profileSection.chemistryGEL', 'Gel Cell Lead-Acid')}</option>
                <option value="LIFEPO4">{t('settings:profileSection.chemistryLiFePO4', 'Lithium Iron Phosphate (LiFePO4)')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('settings:profileSection.batteryVoltage', 'Nominal Battery Bank Voltage')}
              </label>
              <select
                value={batteryVoltage}
                onChange={(e) => setBatteryVoltage(Number(e.target.value))}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
              >
                <option value={12}>12V (1 Battery)</option>
                <option value={24}>24V (2 Batteries - Standard)</option>
                <option value={36}>36V (3 Batteries)</option>
                <option value={48}>48V (4 Batteries)</option>
                <option value={72}>72V (6 Batteries)</option>
                <option value={96}>96V (8 Batteries)</option>
                <option value={192}>192V (16 Batteries - PRO906/910 Bank)</option>
                <option value={240}>240V (20 Batteries)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('settings:profileSection.batteryCapacity', 'Battery Capacity (Ah)')}
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1.0"
                  max="500.0"
                  step="0.5"
                  value={batteryCapacityAh}
                  onChange={(e) => setBatteryCapacityAh(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
                />
                <span className="text-xs font-mono text-slate-400">Ah</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. Telemetry Polling Interval ───────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center space-x-2.5 text-slate-200">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-100">
              {t('settings:pollingSection.title', 'Telemetry Polling Interval')}
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('settings:pollingSection.desc', 'Controls how frequently UPSED queries the hardware for live status (Q1). Takes effect immediately.')}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 pt-2">
          {[2, 5, 10, 30, 60].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                setIntervalVal(sec);
                onPollIntervalChange(sec);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                intervalVal === sec
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                  : 'bg-white/[0.03] border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
              }`}
            >
              {t('settings:pollingSection.pollSeconds', { count: sec, defaultValue: `${sec}s` })} {sec === 10 ? '(Default)' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ── 4b. Historical Graph Resolution & Downsampling ─── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center space-x-2.5 text-slate-200">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-100">
              {t('settings:downsamplingSection.title', 'Historical Graph Resolution & Downsampling')}
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('settings:downsamplingSection.desc', 'Adjust the maximum telemetry points loaded into charts to balance rendering performance and minute-by-minute waveform detail.')}
            </p>
          </div>
        </div>

        <div className="pt-2 max-w-md">
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            {t('settings:downsamplingSection.selectLabel', 'Graph Resolution Threshold')}
          </label>
          <select
            value={downsamplingVal}
            onChange={(e) => setDownsamplingVal(Number(e.target.value))}
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500/60 transition cursor-pointer"
          >
            <option value={1500} className="bg-slate-900 text-slate-200">
              {t('settings:downsamplingSection.points1500', '1,500 points (Aggressive / Lightest)')}
            </option>
            <option value={3000} className="bg-slate-900 text-slate-200">
              {t('settings:downsamplingSection.points3000', '3,000 points (Balanced)')}
            </option>
            <option value={5000} className="bg-slate-900 text-slate-200">
              {t('settings:downsamplingSection.points5000', '5,000 points (Default - High Detail)')}
            </option>
            <option value={10000} className="bg-slate-900 text-slate-200">
              {t('settings:downsamplingSection.points10000', '10,000 points (Ultra Detail)')}
            </option>
            <option value={0} className="bg-slate-900 text-slate-200">
              {t('settings:downsamplingSection.pointsRaw', 'Raw Data (No Downsampling / Unlimited)')}
            </option>
          </select>
        </div>
      </div>

      {/* ── 5. OS Native Battery Bridge & Tray Monitor ──────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3.5"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Battery className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                {t('settings:bridgeSection.title', 'OS Native Battery Bridge & Tray Monitor')}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings:bridgeSection.desc', 'Exposes connected desktop UPS to the operating system as a native battery and taskbar icon.')}
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Active by Default
          </span>
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <div>
            <p className="text-xs font-semibold text-slate-200">{t('settings:bridgeSection.bridgeToggle', 'Emulate Native OS Battery')}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('settings:bridgeSection.optInNotice', 'Updates Windows tray fill gauge, Linux UPower (/dev/uhid), and macOS menu bar.')}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={bridgeVal}
              onChange={(e) => setBridgeVal(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
          </label>
        </div>
      </div>

      {/* ── 6. System Startup & Window Behavior ─────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3.5"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                {t('settings:systemSection.title', 'System Startup & Window Behavior')}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings:systemSection.desc', 'Configure background service behavior on computer boot and dismissal.')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          {/* Dev Mode Autostart Warning Banner */}
          {isDev && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-300">Development Mode Active</p>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  {t('settings:systemSection.autostartDevNotice', 'Automatic startup on system login is disabled in development mode to prevent registering temporary debug binaries into Windows Startup.')}
                </p>
                {autostartVal && (
                  <button
                    type="button"
                    onClick={async () => {
                      await disableAutostart();
                      setAutostartVal(false);
                    }}
                    className="mt-1 px-2.5 py-1 text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-200 transition cursor-pointer"
                  >
                    Clean Up Stale Autostart Entry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Autostart Toggle */}
          <div className={`flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] ${isDev ? 'bg-white/[0.01] opacity-75' : 'bg-white/[0.02]'}`}>
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:systemSection.autostartTitle', 'Start with System Login')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isDev
                  ? 'Disabled in Dev Mode. Available in production release build.'
                  : t('settings:systemSection.autostartDesc', 'Launch UPSED automatically in the background when you log in.')}
              </p>
            </div>
            <label className={`relative inline-flex items-center ${isDev ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={autostartVal}
                disabled={isDev}
                onChange={(e) => setAutostartVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>

          {/* Start Minimized Sub-option */}
          {autostartVal && (
            <div className="flex items-center justify-between p-3.5 ml-4 rounded-xl border border-white/[0.07] bg-white/[0.02]">
              <div>
                <p className="text-xs font-semibold text-slate-200">{t('settings:systemSection.startMinimizedTitle', 'Start Minimized to System Tray')}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t('settings:systemSection.startMinimizedDesc', 'Starts quietly in the system tray at login without opening the application window.')}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={startMinimizedVal}
                  onChange={(e) => setStartMinimizedVal(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
              </label>
            </div>
          )}

          {/* Close to Minimize Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:systemSection.minimizeTrayTitle', 'Close Window to Minimize to Tray')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:systemSection.minimizeTrayDesc', 'Clicking close (×) minimizes to tray so telemetry, outages, and automations run 24/7.')}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={closeToMinimizeVal}
                onChange={(e) => setCloseToMinimizeVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>
        </div>
      </div>

      {/* ── 7. Notifications & Hardware Alarms ──────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3.5"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                {t('settings:notificationsSection.title', 'Notifications & Hardware Alarms')}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings:notificationsSection.desc', 'Configure how critical UPS state transitions, blackouts, and warning flags are delivered.')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:notificationsSection.osNotifTitle', 'Native OS Desktop Notifications')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:notificationsSection.osNotifDesc', 'Send Windows Action Center banners with sound when UPSED is in tray or background.')}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={osNotifVal}
                onChange={(e) => setOsNotifVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div>
              <p className="text-xs font-semibold text-slate-200">{t('settings:notificationsSection.inAppNotifTitle', 'Custom In-App Toasts')}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('settings:notificationsSection.inAppNotifDesc', 'Display floating alerts in the bottom-right corner during live telemetry monitoring.')}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={inAppToastVal}
                onChange={(e) => setInAppToastVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>
        </div>
      </div>

      {/* ── Save / Unsaved Action Bar (Docked when idle, Sticky when dirty) ── */}
      <div
        className={`transition-all duration-300 ease-out ${
          hasUnsavedChanges
            ? 'sticky bottom-3 z-30'
            : 'relative z-10'
        }`}
      >
        <div
          className={`rounded-2xl p-3.5 sm:p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all duration-300 ${
            hasUnsavedChanges
              ? 'shadow-2xl backdrop-blur-xl'
              : 'shadow-sm'
          }`}
          style={
            hasUnsavedChanges
              ? {
                  backgroundColor: 'rgba(15, 23, 42, 0.94)',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  boxShadow:
                    '0 20px 35px -10px rgba(0, 0, 0, 0.7), 0 0 25px -5px rgba(245, 158, 11, 0.25)',
                }
              : {
                  backgroundColor: 'var(--card-bg)',
                  borderColor: savedNotice ? 'rgba(34, 197, 94, 0.4)' : 'var(--card-border)',
                }
          }
        >
          {/* Left status indicator */}
          <div className="flex items-center space-x-3">
            {hasUnsavedChanges ? (
              <>
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-slate-100">
                    {t('settings:unsavedBar.title', 'You have unsaved changes')}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Pending
                  </span>
                </div>
              </>
            ) : savedNotice ? (
              <>
                <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                  <Check className="w-4 h-4" />
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-emerald-400">
                    {t('settings:unsavedBar.savedNotice', 'Preferences saved!')}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Saved
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="p-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-medium text-slate-400">
                    {t('settings:unsavedBar.allSaved', 'All preferences up to date')}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Right action buttons */}
          <div className="flex items-center justify-end space-x-2.5 shrink-0">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={!hasUnsavedChanges || isSaving}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition ${
                hasUnsavedChanges
                  ? 'text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] cursor-pointer'
                  : 'text-slate-600 bg-white/[0.02] border border-white/[0.04] cursor-not-allowed opacity-40'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('settings:unsavedBar.discard', 'Discard')}</span>
            </button>

            {hasUnsavedChanges ? (
              <PrimaryButton
                onClick={() => handleSave()}
                isLoading={isSaving}
                icon={<Save className="w-3.5 h-3.5" />}
                size="md"
              >
                <span>
                  {isSaving
                    ? t('settings:unsavedBar.saving', 'Saving...')
                    : t('settings:unsavedBar.save', 'Save Changes')}
                </span>
              </PrimaryButton>
            ) : (
              <button
                type="button"
                disabled
                className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-500 bg-white/[0.04] border border-white/[0.08] cursor-not-allowed flex items-center space-x-1.5 opacity-40"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{t('settings:unsavedBar.save', 'Save Changes')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Legal & Clean-Room Notice ───────────────────────── */}
      <div
        className="rounded-2xl p-5 text-xs text-slate-400 space-y-3 border"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-300 font-semibold">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Legal Framework & Clean-Room Interoperability</span>
          </div>
          {onOpenAbout && (
            <button
              type="button"
              onClick={onOpenAbout}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition cursor-pointer flex items-center gap-1.5"
            >
              <span>About UPSED</span>
            </button>
          )}
        </div>
        <p className="leading-relaxed text-[11px] text-slate-400">
          UPSED is an independent, clean-room reimplementation designed exclusively for hardware
          interoperability under the <strong>Digital Millennium Copyright Act (DMCA) §1201(f)</strong> and{' '}
          <strong>EU Directive 2009/24/EC Article 6</strong>. It contains no proprietary code, Java bytecode,
          or assets from Voltronic Power's ViewPower software.
        </p>
      </div>
    </div>
  );
});

Settings.displayName = 'Settings';

export default Settings;
