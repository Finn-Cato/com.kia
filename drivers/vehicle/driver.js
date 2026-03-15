'use strict';

const Homey = require('homey');
const KiaApi = require('../../lib/KiaApi');

class VehicleDriver extends Homey.Driver {

  async onInit() {
    this.log('Kia Vehicle driver initialized');
  }

  // ── Pairing ───────────────────────────────────────────────────────────

  async onPair(session) {
    let credentials = null;

    // Step 1: receive credentials from the login view
    session.setHandler('login', async ({ username, password, region, pin }) => {
      if (!username || !password || !region) {
        throw new Error(this.homey.__('pair.error.missing_fields'));
      }

      // Validate by trying to connect and fetching vehicles
      const api = new KiaApi({ username, password, region, pin, logger: this.log.bind(this) });
      const vehicles = await api.getVehicles(); // throws on bad credentials

      if (!vehicles || vehicles.length === 0) {
        throw new Error(this.homey.__('pair.error.no_vehicles'));
      }

      credentials = { username, password, region, pin };
      return true;
    });

    // Step 2: list vehicles for the list_devices template
    session.setHandler('list_devices', async () => {
      if (!credentials) throw new Error('Not logged in');

      const api = new KiaApi({ ...credentials, logger: this.log.bind(this) });
      const vehicles = await api.getVehicles();

      return vehicles.map(v => {
        const cfg = v.vehicleConfig || v;
        return {
          name:  cfg.nickname || cfg.name || cfg.vin,
          data:  { id: cfg.vin },
          store: { credentials },
          icon:  '/icon.svg',
        };
      });
    });
  }

  // ── Repair (update credentials) ───────────────────────────────────────

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password, region, pin }) => {
      if (!username || !password || !region) {
        throw new Error(this.homey.__('pair.error.missing_fields'));
      }

      const api = new KiaApi({ username, password, region, pin, logger: this.log.bind(this) });
      await api.getVehicles(); // validate

      await device.setStoreValue('credentials', { username, password, region, pin });
      device.reInitApi();
      return true;
    });
  }

}

module.exports = VehicleDriver;
