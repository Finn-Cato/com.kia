'use strict';

/**
 * KiaApi — thin wrapper around the `bluelinky` package.
 *
 * bluelinky handles OAuth token acquisition / refresh internally.
 * We only need to re-create the client if credentials change (repair flow).
 */

const _mod = require('bluelinky');
// Handle both CommonJS and TS-compiled default exports
const BlueLinky = _mod.default || _mod;

const CONNECT_TIMEOUT_MS = 30000;

class KiaApi {

  /**
   * @param {object} opts
   * @param {string} opts.username   - Kia Connect email
   * @param {string} opts.password   - Kia Connect password
   * @param {string} opts.region     - 'EU' | 'US' | 'CA' | 'AU'
   * @param {string} [opts.pin]      - Kia Connect PIN (required for remote commands)
   * @param {string} [opts.brand]    - 'kia' (default)
   */
  constructor({ username, password, region, pin = '', brand = 'kia' }) {
    this._credentials = { username, password, region, pin, brand };
    this._client = null;
    this._vehicles = [];
    this._ready = false;
  }

  // ── connection ────────────────────────────────────────────────────────

  /**
   * Initialise the bluelinky client and resolve once the 'ready' event fires.
   * Cached after first call; safe to await multiple times.
   */
  connect() {
    if (this._ready) return Promise.resolve(this._vehicles);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Kia API connection timed out (30 s). Check your credentials and region.'));
      }, CONNECT_TIMEOUT_MS);

      this._client = new BlueLinky({
        username: this._credentials.username,
        password: this._credentials.password,
        brand:    this._credentials.brand,
        region:   this._credentials.region,
        pin:      this._credentials.pin,
      });

      this._client.on('ready', (vehicles) => {
        clearTimeout(timer);
        this._vehicles = vehicles;
        this._ready = true;
        resolve(vehicles);
      });

      this._client.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err.message || String(err)));
      });
    });
  }

  async getVehicles() {
    await this.connect();
    return this._vehicles;
  }

  // ── helpers ───────────────────────────────────────────────────────────

  _findVehicle(vin) {
    const v = this._vehicles.find(v => {
      const cfg = v.vehicleConfig || v;
      return cfg.vin === vin;
    });
    if (!v) throw new Error(`Vehicle VIN ${vin} not found on this account`);
    return v;
  }

  // ── status ────────────────────────────────────────────────────────────

  /**
   * @param {string}  vin
   * @param {boolean} [refresh=false] - true = force a live refresh from the car (costs a request)
   */
  async getStatus(vin, refresh = false) {
    await this.connect();
    const vehicle = this._findVehicle(vin);
    try {
      return await vehicle.status({ refresh });
    } catch (err) {
      if (!refresh) {
        return vehicle.status({ refresh: true });
      }
      throw err;
    }
  }

  // ── commands ──────────────────────────────────────────────────────────

  async lock(vin) {
    await this.connect();
    return this._findVehicle(vin).lock();
  }

  async unlock(vin) {
    await this.connect();
    return this._findVehicle(vin).unlock();
  }

  /**
   * @param {string} vin
   * @param {object} [opts]
   * @param {number} [opts.temperature=22]  - Target cabin temperature in °C
   * @param {boolean} [opts.defrost=false]  - Enable front/rear defrost
   * @param {number}  [opts.heating=0]      - Seat heating level (0 = off)
   * @param {number}  [opts.duration=10]    - Engine-on duration in minutes
   */
  async startClimate(vin, { temperature = 22, defrost = false, heating = 0, duration = 10 } = {}) {
    await this.connect();
    return this._findVehicle(vin).start({
      airCtrl:        true,
      igniOnDuration: duration,
      airTempvalue:   temperature,
      defrost,
      heating1:       heating,
    });
  }

  async stopClimate(vin) {
    await this.connect();
    return this._findVehicle(vin).stop();
  }

  async startCharge(vin) {
    await this.connect();
    return this._findVehicle(vin).startCharge();
  }

  async stopCharge(vin) {
    await this.connect();
    return this._findVehicle(vin).stopCharge();
  }

}

module.exports = KiaApi;
