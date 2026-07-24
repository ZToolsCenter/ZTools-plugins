# AutoMode Sun Mode City Search Design

## Goal

Extend sunrise/sunset mode so users can search for a city, select it explicitly, and schedule theme switches from that location's sunrise and sunset data without caching daily API results locally.

## Scope

This design changes only sunrise/sunset mode.

- Keep automatic location detection via `ipapi.co`.
- Add manual city search via Open-Meteo Geocoding.
- Keep daily sunrise/sunset lookup via `sunrise-sunset.org`.
- Persist only user-selected location data and offsets.
- Do not add offline fallback.

## Current Context

- `preload.js` already supports automatic IP-based location lookup, sunrise/sunset fetches, local config persistence, and scheduled task creation.
- `index.html` already has a sunrise/sunset panel, but location is detection-only and has no search flow.
- `lib/utils.js` already contains pure helpers for offset calculation, XML generation, updater script generation, and sun config validation.
- Current sunrise/sunset time conversion assumes the machine local timezone, which is incorrect once users can select a city outside the machine timezone.

## Chosen Approach

Use one normalized location model for both automatic detection and manual search, then let the UI, persistence layer, and scheduler all consume the same shape.

- Automatic detection remains a convenience path that produces a normalized location object.
- Manual search produces candidate location objects in the same format.
- Sunrise and sunset data is always fetched online for card display and scheduler planning.
- The plugin persists only the chosen location and offsets, never the fetched sunrise or sunset values.

## Time Semantics

Two time views must be handled explicitly and differently:

1. The sunrise and sunset card shows the selected city's local time.
2. The scheduled task time and the "actual switch time" row show the machine local execution time.

This split is required because Windows Task Scheduler runs on the current machine timezone, not the selected city's timezone. If the user selects London while running the plugin on a machine in Shanghai, the plugin must still create tasks using Shanghai local execution times.

The "actual switch time" label should therefore be renamed to "本机实际切换时间".

The scheduler must also stop assuming that one selected-city calendar date maps cleanly to one machine-local calendar date. For cross-timezone cases, the light and dark events for one machine-local day may come from two adjacent city dates.

## Location Model

Use a single normalized location shape:

```js
{
  name,
  region,
  country,
  lat,
  lng,
  timezone,
  source
}
```

- `name`: city name shown to the user.
- `region`: first-level administrative area when available.
- `country`: country name.
- `lat` and `lng`: numeric coordinates.
- `timezone`: IANA timezone identifier.
- `source`: `auto` or `search`, used only for UI labeling.

## Backend Contracts

### Automatic Location

Keep `ipapi.co/json/` as the automatic location source. Map the response into the normalized location model.

- `name` from `city`
- `region` from `region`
- `country` from `country_name`
- `lat` from `latitude`
- `lng` from `longitude`
- `timezone` from `timezone`
- `source` fixed to `auto`

### City Search

Add `searchCities(query)`.

- Call Open-Meteo Geocoding only when the trimmed query length is at least `2`.
- Return a list of normalized location candidates.
- Map `admin1` to `region`.
- Set `source` to `search`.
- Return only the fields the plugin needs:

```js
{
  success: true,
  data: [{ name, region, country, lat, lng, timezone, source: 'search' }]
}
```

### Sunrise/Sunset Fetch

Change the contract to `fetchSunTimes(lat, lng, timezone, date?)`.

- Call `sunrise-sunset.org` with `formatted=0`, the target date, and `tzid=<timezone>`.
- Parse the returned values as the selected city's local sunrise and sunset times.
- Also derive machine-local execution times for scheduling.

Return a structured result:

```js
{
  success: true,
  data: {
    sunriseCity: '06:12',
    sunsetCity: '18:41',
    timezone: 'Europe/London'
  }
}
```

The scheduler does not consume `sunriseCity` and `sunsetCity` directly. It must first convert those city-local instants into machine-local execution times before creating Windows tasks.

### Scheduler Planning

Add a scheduling planner that resolves sunrise and sunset events into one machine-local execution window.

- For UI display, fetch the selected city's current calendar date and show those sunrise and sunset values directly in the card.
- For scheduling, evaluate the machine-local target window instead of assuming one city date is enough.
- The planner should compute the city dates that overlap the target machine-local 24-hour window, fetch those one or two city dates, convert all candidate events into machine-local instants, and choose:
  - one light event within the window
  - one dark event within the window

This planner is required in two places:

- initial sunrise-mode enablement
- daily updater execution

The planner output should be:

```js
{
  success: true,
  data: {
    lightTimeLocal: '13:07',
    darkTimeLocal: '02:31'
  }
}
```

These values are machine-local task times and must be the only times used for task creation.

### Error Contract

All sunrise-mode backend APIs should use one result shape:

```js
{
  success: false,
  error,
  code
}
```

Use these error codes:

- `network_error`
- `empty_result`
- `invalid_config`
- `provider_error`

The UI should map error codes to user-facing copy and avoid rendering raw provider errors directly.

## Persistence

Persist only the selected location and offsets:

```js
{
  lat,
  lng,
  name,
  region,
  country,
  timezone,
  offsetDark,
  offsetLight
}
```

Persist this payload in both:

- `window.ztools.dbStorage` as `automode-sun-config`
- `sun-config.json` for the daily updater task

Do not persist:

- Today's fetched sunrise/sunset result
- Candidate search results
- Derived machine-local execution times

## Enable Flow

Sun-mode enablement must be atomic and rollback-safe.

1. Validate the selected config, including `lat`, `lng`, `timezone`, and offsets.
2. Fetch the selected city's current-date sunrise and sunset for the card display.
3. Resolve the machine-local execution plan for the relevant machine-local window.
4. Create the dark and light switch tasks for machine-local execution.
5. Write `sun-config.json` and persist `automode-sun-config`.
6. Create the daily updater task.
7. Persist `automode-mode = 'sun'` and `automode-enabled = 'true'`.

If any step after task creation fails, rollback the tasks and staged persistence so the plugin does not remain in a half-enabled state.

## Disable Flow

Disabling sunrise mode removes scheduled tasks and clears enabled state, but keeps the last selected config.

- Delete `AutoMode_Dark`, `AutoMode_Light`, and `AutoMode_Updater`.
- Set `automode-enabled` to `false`.
- Clear the active mode marker.
- Keep `automode-sun-config`.
- Keep `sun-config.json`.

This preserves the user's last confirmed selection for the next time the plugin opens.

## Daily Updater

The updater continues to fetch sunrise and sunset data online and rebuild the two theme-switch tasks.

Required updater changes:

- Read `timezone` from `sun-config.json`.
- Run at `23:50` machine-local time rather than `00:05`.
- Plan for the next machine-local calendar day, not the current city date.
- Fetch the city dates that overlap the next machine-local 24-hour window.
- Convert those candidate city-local instants into machine-local execution times before generating the next day's task XML.
- Keep using hidden execution for the updater itself.

## UI Design

### Location Area

Split the location area into two layers:

1. Current selected location summary
2. Search and detection controls

The summary always shows:

- `name, region, country`
- A small source label:
  - `当前定位` for `auto`
  - `手动选择` for `search`

### Search Input

Add a text input with placeholder:

`搜索城市，例如 Tokyo / 上海 / London`

Behavior:

- Do not search when the trimmed input is shorter than `2`.
- Use a `300ms` debounce after typing.
- Do not auto-select the first result.
- Clicking a result updates the current selected location and immediately refreshes sunrise, sunset, and machine-local execution times.

### Search Result List

Each candidate row shows:

- First line: `name`
- Second line: `region, country · timezone`

Result panel states:

- Hidden for empty or too-short input
- Loading
- Result list
- Empty result
- Request failure

### Current Location Button

Keep the existing location button but rename it to `使用当前位置`.

Clicking it:

- Calls the automatic location API
- Replaces the current selected location with the normalized automatic result
- Refreshes sunrise, sunset, and machine-local execution times

### Sunrise/Sunset Card

The card displays the selected city's local sunrise and sunset times.

- Label the values clearly as the selected city's time.
- If fetching fails, show an error state in the card and hide the machine-local execution row.

### Execution Time Row

Rename the row to `本机实际切换时间`.

- Show machine-local light and dark switch times after offsets are applied.
- Hide the row when the plugin does not yet have a valid selected location and a valid sunrise/sunset fetch result.

### Toggle Rules

Selecting a city does not enable sunrise mode automatically.

Only turning on `sunToggle`:

- persists the configuration
- creates the tasks
- marks the plugin as enabled

The toggle can only be turned on when:

- a current selected location exists
- sunrise/sunset data for that location has been fetched successfully

## State Recovery

When the plugin opens and a saved sun config exists:

1. Restore the saved location summary and offsets.
2. Do not repopulate the search input with the saved city name.
3. Fetch the current day's sunrise and sunset online.
4. Refresh the machine-local execution row.

If the fetch fails on open:

- Keep the saved location summary and offsets visible.
- Show the sunrise/sunset area in an error state.
- Hide the machine-local execution row.
- Prevent enabling sunrise mode until a fresh fetch succeeds.

## Failure Handling

Failures in different flows must remain isolated.

- Search failure must not clear the currently selected location.
- Sunrise/sunset refresh failure must not clear saved offsets.
- Automatic re-detection failure must not overwrite a manually selected city.
- Search input text must not be treated as the selected location until the user explicitly clicks a result.

The last confirmed selected location always wins over transient search state.

## File Responsibilities

- `preload.js`
  - Add city search IO
  - Normalize provider responses
  - Fetch timezone-aware sunrise/sunset data
  - Convert city-local instants into machine-local task times
  - Keep persistence and task orchestration here
- `lib/utils.js`
  - Add pure location normalization helpers
  - Extend sun config validation to require `timezone`
  - Keep offset calculations pure
- `lib/ui-state.js`
  - Add pure helpers for search panel states and sunrise enablement rules
- `index.html`
  - Add the search input, result list, source badges, error states, and the machine-local execution label
- `test/utils.test.js`
  - Cover normalization, validation, and time-conversion-related pure helpers
- `test/schedule-ui.test.js` or `test/sun-ui-state.test.js`
  - Cover search-state and enablement-state derivation

## Testing

### Automated

- Add tests for `normalizeIpLocation()`.
- Add tests for `normalizeGeocodeResult()`.
- Add tests for `validateSunConfig()` requiring `timezone`.
- Add tests for sunrise-mode UI state helpers:
  - result panel visibility
  - empty-result state
  - error state
  - enable-toggle eligibility

### Manual

Validate on Windows:

1. Automatic location detection shows the current location and fetches the current day's sunrise and sunset.
2. Searching for a city in a different timezone shows that city's local sunrise and sunset correctly.
3. The machine-local execution row changes to local machine time rather than the selected city's clock time.
4. For a cross-timezone city, the two scheduled events are resolved from the correct machine-local day window even when they come from two adjacent city dates.
5. Searching and selecting a city does not create tasks until `sunToggle` is enabled.
6. Enabling sunrise mode creates three tasks and writes `timezone` into `sun-config.json`.
7. Reopening the plugin restores the saved city and offsets, then refetches the current day's sunrise and sunset online.
8. Disconnecting the network after saving a city leaves the saved selection visible but shows the sunrise/sunset section in an error state and prevents re-enabling until fetch succeeds.

## External Dependencies

- `ipapi.co/json/` for automatic location detection
- Open-Meteo Geocoding API for city search
- `sunrise-sunset.org/json` for daily sunrise and sunset data

The plugin should document these dependencies as network requirements for sunrise mode.
