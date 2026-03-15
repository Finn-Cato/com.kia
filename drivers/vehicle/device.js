'use strict';

const Homey = require('homey');
const KiaApi = require('../../lib/KiaApi');

// Polling intervals
const POLL_INTERVAL_NORMAL_MS  = 5 * 60 * 1000;  // 5 minutes
const POLL_INTERVAL_CHARGING_MS = 2 * 60 * 1000; // 2 minutes while charging
const LOW_BATTERY_THRESHOLD = 20;                 // % — triggers alarm_battery

class VehicleDevice extends Homey.Device {

  async onInit() {
    this.log(`Kia device init: ${this.getName()}`);
    this._api = null;
    this._pollTimer = null;

    await this._initApi();
    await this._poll();
    this._schedulePoll();

    // Allow capability 'locked' to trigger lock/unlock via UI toggle
    this.registerCapabilityListener('locked', async (value) => {
      if (value) {
        await this.lockCar();
      } else {
        await this.unlockCar();
      }
    });
  }

  // ── API initialisation ────────────────────────────────────────────────

  async _initApi() {
    const credentials = this.getStoreValue('credentials');
    if (!credentials) throw new Error('No credentials stored — please repair the device');
    this._api = new KiaApi({ ...credentials, logger: this.log.bind(this) });
    await this._api.connect();
  }

  reInitApi() {
    this._clearPoll();
    this._initApi()
      .then(() => this._poll())
      .then(() => this._schedulePoll())
      .catch(err => this.error('reInitApi error', err));
  }

  // ── Polling ───────────────────────────────────────────────────────────

  _schedulePoll() {
    this._clearPoll();
    const isCharging = this.getCapabilityValue('kia_charging') === true;
    const interval   = isCharging ? POLL_INTERVAL_CHARGING_MS : POLL_INTERVAL_NORMAL_MS;

    this._pollTimer = this.homey.setTimeout(async () => {
      await this._poll().catch(err => this.error('Poll error', err));
      this._schedulePoll(); // reschedule after each poll
    }, interval);
  }

  _clearPoll() {
    if (this._pollTimer) {
      this.homey.clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _poll() {
    const vin = this.getData().id;
    let status;

    try {
      status = await this._api.getStatus(vin, false);
    } catch (err) {
      this.error('Status fetch failed:', err.message);
      this.setUnavailable(err.message).catch(() => {});
      return;
    }

    this.setAvailable().catch(() => {});
    await this._applyStatus(status);
  }

  // ── Status mapping ────────────────────────────────────────────────────

  async _applyStatus(s) {
    // ── Battery / fuel ───────────────────────────────────────────────────
    const batteryLevel =
      s.evStatus?.batteryStatus          // EV battery %
      ?? s.battery?.batSoc               // fallback key from some regions
      ?? s.fuelLevel                     // ICE fuel %
      ?? null;

    if (batteryLevel !== null) {
      const prev = this.getCapabilityValue('measure_battery');
      await this.setCapabilityValue('measure_battery', batteryLevel).catch(() => {});

      if (prev !== batteryLevel) {
        await this.homey.flow
          .getDeviceTriggerCard('battery_changed')
          .trigger(this, { battery: batteryLevel })
          .catch(() => {});
      }

      const lowBat = batteryLevel <= LOW_BATTERY_THRESHOLD;
      await this.setCapabilityValue('alarm_battery', lowBat).catch(() => {});
    }

    // ── Charging ─────────────────────────────────────────────────────────
    const isCharging =
      s.evStatus?.batteryCharge === true
      || s.evStatus?.chargeMode > 0
      || false;

    const wasCharging = this.getCapabilityValue('kia_charging');
    await this.setCapabilityValue('kia_charging', isCharging).catch(() => {});

    if (!wasCharging && isCharging) {
      await this.homey.flow
        .getDeviceTriggerCard('charging_started')
        .trigger(this)
        .catch(() => {});
    } else if (wasCharging && !isCharging) {
      await this.homey.flow
        .getDeviceTriggerCard('charging_stopped')
        .trigger(this)
        .catch(() => {});
    }

    // ── Range ─────────────────────────────────────────────────────────────
    const range =
      s.evStatus?.drvDistance?.[0]?.rangeByFuel?.totalAvailableRange?.value
      ?? s.dte?.value
      ?? null;

    if (range !== null) {
      await this.setCapabilityValue('kia_range', Math.round(range)).catch(() => {});
    }

    // ── Locks ─────────────────────────────────────────────────────────────
    // doorLock: true = locked, false = unlocked
    const locked = s.doorLock ?? null;
    if (locked !== null) {
      await this.setCapabilityValue('locked', locked).catch(() => {});
    }

    // ── Climate ───────────────────────────────────────────────────────────
    const climate =
      s.airCtrlOn
      ?? s.climate?.airCtrl
      ?? false;
    await this.setCapabilityValue('kia_climate', climate).catch(() => {});
  }

  // ── Commands (called by flow cards & capability listener) ─────────────

  async lockCar() {
    const vin = this.getData().id;
    await this._api.lock(vin);
    await this.setCapabilityValue('locked', true).catch(() => {});
  }

  async unlockCar() {
    const vin = this.getData().id;
    await this._api.unlock(vin);
    await this.setCapabilityValue('locked', false).catch(() => {});
  }

  async startClimate(temperature = 22) {
    const vin = this.getData().id;
    await this._api.startClimate(vin, { temperature });
    await this.setCapabilityValue('kia_climate', true).catch(() => {});
  }

  async stopClimate() {
    const vin = this.getData().id;
    await this._api.stopClimate(vin);
    await this.setCapabilityValue('kia_climate', false).catch(() => {});
  }

  async startCharge() {
    const vin = this.getData().id;
    await this._api.startCharge(vin);
    await this.setCapabilityValue('kia_charging', true).catch(() => {});
    this._schedulePoll(); // switch to faster polling
  }

  async stopCharge() {
    const vin = this.getData().id;
    await this._api.stopCharge(vin);
    await this.setCapabilityValue('kia_charging', false).catch(() => {});
    this._schedulePoll(); // switch back to normal polling
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async onDeleted() {
    this._clearPoll();
    this.log(`Kia device deleted: ${this.getName()}`);
  }

}

module.exports = VehicleDevice;
