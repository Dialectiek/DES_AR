# Illuminator model schemas

Source: `illuminator-team/website@d74a6bdaa29a3a88ae751b6c78542f5a221906ac` (built 2026-03-06T16:09:17Z), fetched 2026-11-24T11:16:38.248Z. 29 models.

## Agent

### GenerationCompanyAgent

`illuminator.models.Agents.generators.generation_company_agent_v3.GenerationCompanyAgent` · [docs](https://illuminator-team.github.io/website/references/Agents/Agents.html#illuminator.models.Agents.generators.generation_company_agent_v3.GenerationCompanyAgent)

Generation Company Agent that participates in electricity markets by submitting bids.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `automated_bids` | `true` | bool | Flag to determine if bids are generated automatically based on marginal costs |
| `bids_manual` | `None` | pd.DataFrame, optional | Manual bid data if automated_bids is False |
| `company_name` | `"no name"` | str | Name identifier for the generation company |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `portfolio` | `{}` | dict | Portfolio of power plants with their characteristics (capacity, cost, availability) |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `bids` | `{}` | dict | Current market bids for each power plant |
| `profit` | `0` | float | Cumulative profit from market operations |

### JusticeAgent

`illuminator.models.Agents.justice_agent.justice_agent_v3.JusticeAgent` · [docs](https://illuminator-team.github.io/website/references/Agents/Agents.html#illuminator.models.Agents.justice_agent.justice_agent_v3.JusticeAgent)

Justice evaluator agent that calculates justice metrics for electricity market participants.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `justice_step` | `None` | int | Time step at which to calculate final justice scores |
| `results_dir` | `"justice_agent_results"` | str, optional | Directory to save justice metric results, defaults to 'justice_agent_results' |
| `social_parameters` | `None` | dict | Dictionary containing social parameter weights (a,b,c,d) for each company |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `demand` | `0` | float | Total market demand |
| `market_results` | `None` | pd.DataFrame | Market clearing results with company capacities, revenues, costs and profits |
| `marketclearingprice` | `0` |  |  |
| `market_clearing_price` | — | float | Market clearing price |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `alpha_scores` | `{}` | dict | Social parameter weights for each company |
| `beta_scores` | `{}` | dict | Cumulative market shares for each company |
| `justice_score` | `None` | float | Overall justice metric |

> ⚠️ inputs: 'market_clearing_price' is in the docstring but not in the code's inputs

### Operator_Market

`illuminator.models.Agents.operators.operator_v3.Operator_Market` · [docs](https://illuminator-team.github.io/website/references/Agents/Agents.html#illuminator.models.Agents.operators.operator_v3.Operator_Market)

Market operator agent responsible for clearing the electricity market.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `results_dir` | `"operator_results"` | str | Directory to save market results and visualizations |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `bids` | `{}` | dict or list[dict] | Bid information from generators containing prices and capacities |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `demand` | `None` | float | Total market demand in MW |
| `market_clearing_price` | `0` | float | Cleared market price in €/MWh |
| `market_results_summary` | `None` | dict | Summary of market results including revenues and profits |

## Component

### Collector

`illuminator.models.Collector.collector_v3.Collector` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Collector.collector_v3.Collector)

A model for writing time series data to CSV files.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `date_format` | — | str | Format of the date/time column in the CSV file |
| `delimiter` | — | str | Column delimiter character in the CSV file (default ',') |
| `datafile` | — | str / list | [list of] Path to the CSV file to read from |
| `send_row` | — | bool | If True, sends the entire row as a dictionary under the key 'row'. If False, sends individual columns as separate states. |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `file_index` | — | int (optional) | If multiple files are provided, this input selects which file to read from. |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `next_row` | — | dict (optional, if send_row is True) | The next row of data read from the CSV file. |
| `<column_name>` | — | float (for each column in the CSV file, if send_row is False) | The value of each column in the current row. |

> ⚠️ no class-level parameters/inputs/outputs/states (built dynamically); schema taken from the docstring only

### CSV

`illuminator.models.CSV_reader_v3.CSV` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.CSV_reader_v3.CSV)

A model for reading time series data from CSV files.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `date_format` | — | str | Format of the date/time column in the CSV file |
| `delimiter` | — | str | Column delimiter character in the CSV file (default ',') |
| `datafile` | — | str / list | [list of] Path to the CSV file to read from |
| `send_row` | — | bool | If True, sends the entire row as a dictionary under the key 'row'. If False, sends individual columns as separate states. |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `file_index` | — | int (optional) | If multiple files are provided, this input selects which file to read from. |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `next_row` | — | dict (optional, if send_row is True) | The next row of data read from the CSV file. |
| `<column_name>` | — | float (for each column in the CSV file, if send_row is False) | The value of each column in the current row. |

> ⚠️ no class-level parameters/inputs/outputs/states (built dynamically); schema taken from the docstring only

### GridConnection

`illuminator.models.Gridconnection.grid_connection_v3.GridConnection` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Gridconnection.grid_connection_v3.GridConnection)

Grid connection model that monitors power flows and sets warning flags for grid congestion.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `connection_capacity` | `None` | float | Maximum power capacity of the grid connection (kW) |
| `critical_limit` | `None` | float | Threshold for critical flag as fraction of connection capacity (e.g. 0.9 = 90%) |
| `tolerance_limit` | `None` | float | Threshold for warning flag as fraction of connection capacity (e.g. 0.8 = 80%) |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `dump` | `0` | float | Power flow through grid connection (kW, negative for export) |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `flag_critical` | `None` | int | Flag indicating critical limit exceeded (1) or not (0) |
| `flag_warning` | `None` | int | Flag indicating warning limit exceeded (1) or not (0) |

### PV

`illuminator.models.PV.pv_model_v3.PV` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.PV.pv_model_v3.PV)

A PV model that calculates power generation based on environmental conditions.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `G_NOCT` | `0` | float | Irradiance at NOCT conditions in W/m² |
| `NOCT` | `0` | float | Nominal Operating Cell Temperature in °C |
| `P_STC` | `0` | float | Power output under standard test conditions in W |
| `cap` | `0` | float | Installed capacity in kW |
| `m_area` | `0` | float | Module area of the PV panel in m² |
| `m_az` | `0` | float | Module azimuth angle in degrees |
| `m_efficiency_stc` | `0` | float | Module efficiency under standard test conditions |
| `m_tilt` | `0` | float | Module tilt angle in degrees |
| `output_type` | `"power"` | str | Output type ('power' or 'energy') |
| `peak_power` | `0` |  |  |
| `sim_start` | `0` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `Az` | `0` | float | Sun azimuth angle in degrees |
| `FF` | `0` | float | Wind speed in m/s |
| `G_Bn` | `0` | float | Direct normal irradiance in W/m² |
| `G_Dh` | `0` | float | Diffuse horizontal irradiance in W/m² |
| `G_Gh` | `0` | float | Global horizontal irradiance in W/m² |
| `Ta` | `0` | float | Ambient temperature in °C |
| `hs` | `0` | float | Solar elevation angle in degrees |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `g_aoi` | `0` | float | Total irradiance considering angle of incidence in W/m² |
| `pv_gen` | `0` | float | PV generation in kW or kWh |
| `total_irr` | `0` | float | Total irradiance on tilted surface in W/m² |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `pv_gen` | `0` |  |  |

### Wind

`illuminator.models.Wind.wind_v3.Wind` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Wind.wind_v3.Wind)

A wind turbine model that calculates power generation based on wind speed.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `cp` | `0.4` | float | Coefficient of performance (Betz limit max 0.59) |
| `diameter` | `30` | float | Rotor diameter (m) |
| `output_type` | `"power"` | str | Output type ('power' or 'energy') |
| `p_rated` | `500` | float | Rated power output (kW) at rated wind speed |
| `u_cutin` | `1` | float | Cut-in wind speed (m/s) |
| `u_cutout` | `1000` | float | Cut-out wind speed (m/s) |
| `u_rated` | `100` | float | Rated wind speed (m/s) |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `u` | `0` | float | Wind speed at hub height (m/s) |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `u` | `0` | float | Adjusted wind speed at 25m height (m/s) |
| `wind_gen` | `0` | float | Wind generation in kW or kWh |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `u25` | `0` | float | Wind speed at 25m height (m/s) |
| `u60` | `10` | float | Wind speed at 60m height (m/s) |

### Load

`illuminator.models.Load.load_v3.Load` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Load.load_v3.Load)

Calculates total load demand based on number of houses and input load.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `houses` | `1` | int | Number of houses that determine the total load demand |
| `input_type` | `"energy"` |  |  |
| `output_type` | `"power"` | str | Type of output for consumption calculation ('energy' or 'power') |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `load` | `0` | float | Incoming energy or power demand per house in kW or kWh |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `consumption` | `0` | float | Current energy or power consumption based on the number of houses and input load (kWh) |
| `load_dem` | `0` | float | Total energy or power consumption for all houses (kWh) over the time step |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `forecast` | `None` | None | Placeholder for future load forecasting functionality |
| `time` | `None` | int | Current simulation time in seconds |

### LoadEV

`illuminator.models.Load.LoadEV.load_EV_v3.LoadEV` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Load.LoadEV.load_EV_v3.LoadEV)

Calculates total load demand based on number of houses and input load.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `houses_case` | `None` |  |  |
| `houses_data` | `None` |  |  |
| `load` | — | float | Input load per house in kW or kWh depending on output_type |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `n` | `0` |  |  |
| `power` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `load_EV` | `0` |  |  |

**States:** none

> ⚠️ parameters: 'load' is in the docstring but not in the code's parameters

### LoadHeatpump

`illuminator.models.Load.LoadHeatpump.load_heatpump_v3.LoadHeatpump` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Load.LoadHeatpump.load_heatpump_v3.LoadHeatpump)

Heat pump load model for calculating and scaling demand based on number of houses.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `houses_case` | `1` | int | Target number of houses to scale demand for |
| `houses_data` | `None` | int | Reference number of houses in the input data |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `hp_load` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `load_HP` | `0` |  |  |

**States:** none

### EV

`illuminator.models.ElectricVehicle.EV.EV` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.ElectricVehicle.EV.EV)

A class to represent an Electric Vehicle (EV) charging model. This class provides methods to simulate the charging process of an EV battery.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `end_initial_phase` | `0` |  | soc at which the mid-phase starts [%] |
| `end_mid_phase` | `0` |  | soc at which the final-phase starts [%] |
| `max_power` | `0` |  | Max power from the charger [kW] |
| `battery_cap` | `0` |  | capacity of the battery car [kWh] |
| `fast` | `false` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `load_in` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `demand` | `0` |  | power used by the charger per timestep [kW] |
| `presence` | `0` |  |  |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `soc` | `0` |  | state of charge after operation in a timestep [%] |
| `desired_soc` | `0` |  |  |

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### Battery

`illuminator.models.Battery.battery_v3.Battery` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Battery.battery_v3.Battery)

Battery model class for simulating battery charging and discharging behavior.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `charge_efficiency` | `90` | float | Battery charging efficiency in % |
| `discharge_efficiency` | `90` | float | Battery discharging efficiency in % |
| `max_energy` | `50` | float | Maximum energy storage capacity in kWh |
| `max_p` | `150` | float | Maximum charging power limit in kW |
| `min_p` | `250` | float | Maximum discharging power limit in kW |
| `soc_max` | `80` | float | Maximum allowable state of charge in % |
| `soc_min` | `3` | float | Minimum allowable state of charge in % |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flow2b` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `p_in` | `20` |  |  |
| `p_out` | `20` |  |  |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `flag` | `-1` |  |  |
| `mod` | `0` |  |  |
| `soc` | `0` |  |  |

### H2Buffer

`illuminator.models.Buffer.buffer.H2Buffer` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Buffer.buffer.H2Buffer)

A class to represent an H2 Buffer model. This class provides methods to simulate the hydrogen flow through the buffer.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_soc_min` | `0` |  | Minimum state of charge of the hydrogen buffer before discharging stops [%] |
| `h2_soc_max` | `100` |  | Maximum state of charge of the hydrogen buffer before charging stops [%] |
| `h2_charge_eff` | `100` |  | Charge efficiency of the H2 buffer [%] |
| `h2_discharge_eff` | `100` |  | Discharge efficiency of the H2 buffer [%] |
| `max_flow_rate_in` | `10` |  | maximal flow in [kg/h] |
| `min_flow_rate_in` | `0` |  | minimal flow in [kg/h] |
| `max_flow_rate_out` | `10` |  | maximal flow out [kg/h] |
| `min_flow_rate_out` | `0` |  | minimal flow out [kg/h] |
| `h2_capacity_tot` | `100` |  | total capacity of the hydrogen buffer [kg] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_in` | `0` |  | input to H2 buffer [kg/timestep] |
| `desired_out` | `0` |  | demanded hydrogen output flow [kg/h] |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_out` | `0` |  | flow out of the H2 buffer [kg/timestep] |
| `actual_h2_in` | `0` |  | The input that is processed in the buffer [kg/timestep] |
| `overflow` | `0` |  | Overflow of the buffer [kg/timestep] |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `soc` | `0` |  | state of charge after operation in a timestep [%] |
| `flag` | `0` |  | flag inidicating buffer status (1=fully charged, -1=full discharged, 0=available for control) [-] |
| `available_h2` | `0` |  | amount of hydrogen that is available for the output [kg/timestep] |
| `free_capacity` | `0` |  | amount of hyrogen that can be inputted before being full [kg/timestep] |

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### Electrolyzer

`illuminator.models.Electrolyzer.electrolyzer_v3.Electrolyzer` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Electrolyzer.electrolyzer_v3.Electrolyzer)

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `e_eff` | `70` |  |  |
| `max_p_in` | `10` |  |  |
| `max_p_ramp_rate` | `10` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `desired_out` | `30` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h_gen` | `0` |  |  |
| `power_consumption` | `0` |  |  |

**States:** none

> ⚠️ parameters: defined as a 1-element tuple in code (trailing comma), unwrapped
> ⚠️ inputs: defined as a 1-element tuple in code (trailing comma), unwrapped
> ⚠️ outputs: defined as a 1-element tuple in code (trailing comma), unwrapped
> ⚠️ states: defined as a 1-element tuple in code (trailing comma), unwrapped

### ZZE

`illuminator.models.Electrolyzer.ZZE_v3.ZZE` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Electrolyzer.ZZE_v3.ZZE)

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `e_eff` | `70` |  |  |
| `h2_capacity_tot` | `100` |  |  |
| `h2_charge_eff` | `100` |  |  |
| `h2_discharge_eff` | `100` |  |  |
| `h2_soc_max` | `100` |  |  |
| `h2_soc_min` | `0` |  |  |
| `max_flow_rate_in` | `10` |  |  |
| `max_flow_rate_out` | `10` |  |  |
| `max_p_in` | `10` |  |  |
| `max_p_ramp_rate` | `10` |  |  |
| `min_flow_rate_in` | `0` |  |  |
| `min_flow_rate_out` | `0` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `desired_out` | `30` |  |  |
| `h2_in` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `actual_h2_in` | `0` |  |  |
| `h2_out` | `0` |  |  |
| `h_gen` | `0` |  |  |
| `overflow` | `0` |  |  |
| `power_consumption` | `0` |  |  |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `available_h2` | `0` |  |  |
| `flag` | `0` |  |  |
| `free_capacity` | `0` |  |  |
| `soc` | `0` |  |  |

### Thermolyzer

`illuminator.models.Thermolyzer.thermolyzer_v3.Thermolyzer` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Thermolyzer.thermolyzer_v3.Thermolyzer)

Thermolyzer model class for simulating a thermolyzer that converts biomass and electricity into hydrogen.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `C_CO_2` | `10` |  |  |
| `C_Eelec_h2` | `11.5` | float | Conversion factor electrical energy to hydrogen mass [kWh/kg] |
| `C_bio_h2` | `30` | float | Conversion factor from biomass to hydrogen [-] |
| `eff` | `60` | float | Thermolyzer efficiency as a percentage [%] |
| `max_p_in` | `10000` | float | Maximum input power [kW] |
| `max_ramp_up` | `60` | float | Maximum ramp up in power per timestep [kW/timestep] |
| `CO_2` | — | float | Absorption factor carbondioxide per h2 produced [-] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `biomass_in` | `0` |  |  |
| `desired_out` | `30` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `CO2_out` | `0` |  |  |
| `h_gen` | `0` |  |  |
| `power_consumption` | `0` |  |  |

**States:** none

> ⚠️ parameters: defined as a 1-element tuple in code (trailing comma), unwrapped
> ⚠️ parameters: 'CO_2' is in the docstring but not in the code's parameters
> ⚠️ inputs: defined as a 1-element tuple in code (trailing comma), unwrapped
> ⚠️ outputs: defined as a 1-element tuple in code (trailing comma), unwrapped

### Compressor

`illuminator.models.Compressor.compressor_v3.Compressor` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.Compressor.compressor_v3.Compressor)

A class to represent a Compressor model. This class provides methods to simulate the compression of hydrogen gas.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `p_in` | `30` |  | input pressure [bar] |
| `p_out` | `500` |  | output pressure [bar] |
| `T_amb` | `293.15` |  | ambient temperature [K] |
| `compressor_eff` | `99` |  | compressor efficiency [%] |
| `max_power_in` | `10` |  | maximum power input [kW] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flow2c` | `0` |  | hydrogen flow to the compressor [kg/timestep] |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flow_from_c` | `0` |  | hydrogen flow from the compressor [kg/timestep] |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `power_req` | `0` |  | power required for the compression [kW] |
| `volume_flow_out` | `0` |  | volumetric output flow [m3/timestep] |

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### H2demand

`illuminator.models.H2demand.h2demand_v3.H2demand` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2demand.h2demand_v3.H2demand)

A class to represent an H2demand model. This class provides methods to simulate the demand of hydrogen gas.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `units` | `1` |  | number of demand units |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `demand` | `0` |  |  |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `tot_dem` | `0` |  | total consumption for each timetep (= demand input for units = 1) [kg/timestep] |

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### Pipeline

`illuminator.models.H2pipeline.h2pipeline.Pipeline` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2pipeline.h2pipeline.Pipeline)

A class to represent a Pipeline model. This class provides methods to simulate the flow of hydrogen gas through a pipeline.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `A` | `2` |  | cross-sectional area of the pipe [m2] |
| `L` | `100` |  | length of the pipe [m] |
| `p_outer` | `1` |  | pressure outside of the pipe [bar] |
| `T_amb` | `293.15` |  | ambient temperature [K] |
| `d` | `0.01` |  | pipe thickness [m] |
| `eps` | `0.0000015` |  | pipe roughness [m] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flow_in` | `0` |  | hydrogen flow to into the pipeline [kg/timestep] |
| `pressure_in` | `0` |  | input pressure of the hydrogen |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flow_out` | `0` |  | hydrogen flow out of the pipeline [kg/timestep] |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `press_out` | `0` |  | output pressure of the hydrogen [bar] |

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### H2Storage

`illuminator.models.H2storage.h2storage_v3.H2Storage` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2storage.h2storage_v3.H2Storage)

A class to represent an H2 Storage model. This class provides methods to simulate the charging and discharging of hydrogen storage.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_soc_min` | `0` |  | Minimum state of charge of the hydrogen storage before discharging stops [%] |
| `h2_soc_max` | `100` |  | Maximum state of charge of the hydrogen storage before charging stops [%] |
| `h2_charge_eff` | `100` |  | Charge efficiency of the H2 storage [%] |
| `h2_discharge_eff` | `100` |  | Discharge efficiency of the H2 storage [%] |
| `max_h2` | `10` |  | maximal flow (?) [kg/timestep] |
| `min_h2` | `-10` |  | minimal flow (?) [kg/timestep] |
| `h2_capacity_tot` | `100` |  | total capacity of the hydrogen strorage [kg] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flow2h2storage` | `0` |  | pos or neg flow to H2 storage [kg/timestep] |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_in` | `0` |  | flow into the H2 storage [kg/timestep] |
| `h2_out` | `0` |  | flow out of the H2 storage [kg/timestep] |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `soc` | `0` |  | state of charge after operation in a timestep [%] |
| `mod` | `0` |  | operating mode (1=charge, -1=discharge, 0=no action) [-] |
| `flag` | `0` |  | flag inidicating storage status (1=fully charged, -1=full discharged, 0=available for control) [-] |

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### H2Valve

`illuminator.models.H2valve.h2valve_v3.H2Valve` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2valve.h2valve_v3.H2Valve)

A class to represent a Valve model for controlling hydrogen flow in a system. This class provides methods to manage the flow of hydrogen through the valve.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `valve_eff` | `100` |  | ,   # efficicency of the valve [%] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_in` | `0` |  | h2 input |
| `ratio1` | `0` |  | fraction of the flow that is allowed to pass through output 1 [%] |
| `ratio2` | `0` |  | fraction of the flow that is allowed to pass through output 2 [%] |
| `ratio3` | `0` |  | fraction of the flow that is allowed to pass through output 3 [%] |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `out1` | `0` |  | h2 output 1 |
| `out2` | `0` |  | h2 output 2 |
| `out3` | `0` |  | h2 output 3 |

**States:** none

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### H2Joint

`illuminator.models.H2_joint.H2_joint_v3.H2Joint` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2_joint.H2_joint_v3.H2Joint)

A class to represent a Valve model for controlling hydrogen flow in a system. This class provides methods to manage the flow of hydrogen through the joint.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `joint_eff` | `100` |  | ,   # efficicency of the joint [%] |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_in_1` | `0` |  | h2 input 1 |
| `h2_in_2` | `0` |  | h2 input 2 |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `out` | `0` |  | h2 output |

**States:** none

> ⚠️ keys and defaults read from the code (illuminator-team/Illuminator@main) because the docs page omits them

### H2Controller

`illuminator.models.H2controller.H2_controller_v3.H2Controller` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2controller.H2_controller_v3.H2Controller)

A class to represent a Controller model for a hybrid renewable energy system. This class provides methods to manage power flows between renewable sources, battery storage, and hydrogen systems.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `size_storage1` | `0` |  |  |
| `size_storage2` | `0` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `demand1` | `0` |  |  |
| `demand2` | `0` |  |  |
| `h2_soc1` | `0` |  |  |
| `h2_soc2` | `0` |  |  |
| `thermolyzer_out` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `dump` | `0` |  |  |
| `flow2h2storage1` | `0` |  |  |
| `flow2h2storage2` | `0` |  |  |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `valve1_ratio1` | `0` |  |  |
| `valve1_ratio2` | `0` |  |  |
| `valve1_ratio3` | `0` |  |  |
| `valve2_ratio1` | `0` |  |  |
| `valve2_ratio2` | `0` |  |  |
| `valve2_ratio3` | `0` |  |  |

### H2Controller2

`illuminator.models.H2controller.H2_controller2.H2Controller2` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2controller.H2_controller2.H2Controller2)

A class to represent a Controller model for a hybrid renewable energy system. This class provides methods to manage flows in and out of a buffer.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `dummy` | `0` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `buffer_available_h2` | `0` |  |  |
| `buffer_free_capacity` | `0` |  |  |
| `demand1` | `0` |  |  |
| `demand2` | `0` |  |  |
| `thermolyzer_out` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `dump` | `0` |  |  |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `buffer_in` | `0` |  |  |
| `desired_out` | `0` |  |  |
| `valve1_ratio1` | `0` |  |  |
| `valve1_ratio2` | `0` |  |  |
| `valve1_ratio3` | `0` |  |  |

### H2ControllerExample

`illuminator.models.H2controller.H2_controller_example.H2ControllerExample` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2controller.H2_controller_example.H2ControllerExample)

A class to represent a Controller model for a hybrid renewable energy system. This class provides methods to manage flows in and out of a buffer.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `dummy` | `0` |  |  |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `buffer_available_h2` | `0` |  |  |
| `buffer_free_capacity` | `0` |  |  |
| `demand` | `0` |  |  |
| `h2_out` | `0` |  |  |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `dump` | `0` |  |  |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `buffer_in` | `0` |  |  |
| `desired_out` | `0` |  |  |

### H2PSA

`illuminator.models.H2PSA.PSA_v3.H2PSA` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.H2PSA.PSA_v3.H2PSA)

A Pressure Swing Adsorption (PSA) model for hydrogen purification.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `efficiency` | `100` | float | Efficiency of the PSA unit as a percentage [%]. |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_in` | `0` | float | Hydrogen flow entering the PSA [kg/timestep]. |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `h2_out` | `0` | float | Purified hydrogen flow leaving the PSA [kg/timestep]. |

**States:** none

## Data

### CSV

`illuminator.models.CSV_reader_v3.CSV` · [docs](https://illuminator-team.github.io/website/references/Components/Components.html#illuminator.models.CSV_reader_v3.CSV)

A model for reading time series data from CSV files.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `date_format` | — | str | Format of the date/time column in the CSV file |
| `delimiter` | — | str | Column delimiter character in the CSV file (default ',') |
| `datafile` | — | str / list | [list of] Path to the CSV file to read from |
| `send_row` | — | bool | If True, sends the entire row as a dictionary under the key 'row'. If False, sends individual columns as separate states. |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `file_index` | — | int (optional) | If multiple files are provided, this input selects which file to read from. |

**Outputs:** none

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `next_row` | — | dict (optional, if send_row is True) | The next row of data read from the CSV file. |
| `<column_name>` | — | float (for each column in the CSV file, if send_row is False) | The value of each column in the current row. |

> ⚠️ no class-level parameters/inputs/outputs/states (built dynamically); schema taken from the docstring only

## Controller

### Controller_T1

`illuminator.models.Controllers.controller_T1.controller_T1_v3.Controller_T1` · [docs](https://illuminator-team.github.io/website/references/Controllers/Controllers.html#illuminator.models.Controllers.controller_T1.controller_T1_v3.Controller_T1)

Controller for managing power flows between renewable generation, load, and battery storage.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `battery_active` | `true` | bool | Flag to enable/disable battery operation |
| `max_p` | `100` | float | Maximum power to/from the battery (kW) |
| `soc_max` | `100` | float | Maximum state of charge of the battery before charging stops (%) |
| `soc_min` | `0` | float | Minimum state of charge of the battery before discharging stops (%) |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `load_dem` | `0` | float | Electrical load demand (kW) |
| `pv_gen` | `0` | float | Solar power generation (kW) |
| `soc` | `0` | float | State of charge of the battery (%) |
| `wind_gen` | `0` | float | Wind power generation (kW) |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `dump` | `0` | float | Excess power that cannot be stored or used (kW) |
| `flow2b` | `0` | float | Power flow to/from battery (kW, positive for charging, negative for discharging) |
| `res_load` | `0` | float | Residual load after renewable generation (kW) |

**States:** none

### ControllerT3Congestion

`illuminator.models.Controllers.controller_T3Congestion.controller_T3Congestion_v3.ControllerT3Congestion` · [docs](https://illuminator-team.github.io/website/references/Controllers/Controllers.html#illuminator.models.Controllers.controller_T3Congestion.controller_T3Congestion_v3.ControllerT3Congestion)

Controller for managing power flows between renewable generation, load, battery storage, and electrified assets.

**Parameters**

| Name | Default | Type | Description |
|---|---|---|---|
| `battery_active` | `true` | bool | Flag to enable/disable battery operation |
| `elec_assets` | `true` | bool | Flag to enable/disable electrified assets |
| `gridconnect_ctrl` | `15` | float | Grid connection capacity limit (kW) |
| `load_shift_active` | `true` | bool | Flag to enable/disable load shifting during congestion warnings |
| `max_p` | `100` | float | Maximum power to/from the battery (kW) |
| `soc_max` | `100` | float | Maximum state of charge of the battery before charging stops (%) |
| `soc_min` | `0` | float | Minimum state of charge of the battery before discharging stops (%) |

**Inputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `flag_warning` | `None` | int | Warning flag for grid congestion |
| `load_EV` | `0` | float | Electric vehicle load demand (kW) |
| `load_HP` | `0` | float | Heat pump load demand (kW) |
| `load_dem` | `0` | float | Base electrical load demand (kW) |
| `pv_gen` | `0` | float | Solar power generation (kW) |
| `soc` | `0` | float | State of charge of the battery (%) |
| `wind_gen` | `0` | float | Wind power generation (kW) |

**Outputs**

| Name | Default | Type | Description |
|---|---|---|---|
| `dump` | `0` | float | Excess power that cannot be stored or used (kW) |
| `flow2b` | `0` | float | Power flow to/from battery (kW, positive for charging, negative for discharging) |
| `res_load` | `0` | float | Residual load after renewable generation (kW) |

**States**

| Name | Default | Type | Description |
|---|---|---|---|
| `limit_grid_connect` | `None` | float | Grid connection limit for congestion management (kW) |
