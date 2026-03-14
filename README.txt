Kia Connect for Homey

Control your Kia vehicle directly from Homey using the official Kia Connect / UVO cloud API.

Features

- Battery / Fuel level — live percentage shown in Homey
- Range — estimated range in km
- Doors locked capability with UI toggle
- Charging state sensor
- Climate state sensor
- Low battery alarm

Flow cards

Triggers:
- Charging started
- Charging stopped
- Battery / fuel level changed (token: level %)

Conditions:
- Car is / is not charging
- Car doors are / are not locked

Actions:
- Lock the car
- Unlock the car
- Start climate control (with temperature)
- Stop climate control
- Start charging
- Stop charging

Supported regions

EU - Europe
US - United States
CA - Canada
AU - Australia

Setup

1. Install the app on your Homey
2. Go to Devices > Add device > Kia Connect > Kia Vehicle
3. Select your region, enter your Kia Connect / UVO e-mail, password and PIN
4. All vehicles on the account will be listed - add the ones you want

PIN: The 4-digit PIN set in the Kia Connect / UVO app. Required for remote commands (lock, unlock, climate, charge).

EU Login Note

Kia Europe has recently added reCAPTCHA to its login flow. EU users must use a refresh token instead of their password. Visit https://github.com/Finn-Cato/com.kia for instructions.

Polling

- Normal: every 5 minutes
- While charging: every 2 minutes (automatically detected)

Notes

- Kia Connect API rate-limits requests. Avoid triggering many flow actions in rapid succession.
- This app is not affiliated with or endorsed by Kia Motors.
