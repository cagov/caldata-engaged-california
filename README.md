# CalData Engaged California

## Repository Overview
This repository contains data engineering and analytics workflows used for preparing, modeling, and presenting data assets used in the [Engaged California](https://engaged.ca.gov/) program.
The primary goal for making this repo public is to provide transparency into the analytics methods used to surface the insights in the published Engaged California reports.
The repository contains [dbt](https://docs.getdbt.com/docs/introduction) SQL models that transform source data into data sets ready for analytics and reporting. In addition to using dbt for SQL modeling, we use Snowflake as our data warehouse and Streamlit for generating interactive visualizations.

To view more in-depth project documentation-- including data definitions, data lineage, and other information about the code used to load, transform, and analyze participation data for each of the three EngagedCA engagements run between March - December 2025, please see the dbt documentation here: https://cagov.github.io/caldata-engaged-california/dbt/#!/overview/caldata_engaged_california

## Multiple Engagements
The Engaged California program has published reports from multiple engagements. These include:
- [Los Angeles Fire Recovery](https://engaged.ca.gov/lafires-recovery/)
  - [Agenda Setting Findings](https://engaged.ca.gov/lafires-recovery/agenda-setting-findings/)
  - To view dbt code used to shape and analyze this data, look for any models tagged "la_fires_phase_1". You can find these tags in dbt_project.yml or in the DAG here: https://cagov.github.io/caldata-engaged-california/dbt/#!/overview?g_v=1 by selecting the "la_fires_phase_1" in the tagging filter at the bottom of the page.
  - [Agenda Setting Data Deep Dive](https://engaged.ca.gov/lafires-recovery/agenda-setting-data-insights/)
  - [Action Plan](https://engaged.ca.gov/lafires-recovery/action-plan/)
    - To view dbt code used to shape and analyze this data, look for any models tagged "la_fires_phase_2". You can find these tags in dbt_project.yml or in the DAG here: https://cagov.github.io/caldata-engaged-california/dbt/#!/overview?g_v=1 by selecting the "la_fires_phase_2" in the tagging filter at the bottom of the page.
- [State Employee Efficiency Ideas](https://engaged.ca.gov/stateemployees/)
  - [Findings](https://e3-staging.pr.engaged.ca.gov/stateemployees/efficiency/)  - To view dbt code used to shape and analyze this data, look for any models tagged "state_employees". You can find these tags in dbt_project.yml or in the DAG here: https://cagov.github.io/caldata-engaged-california/dbt/#!/overview?g_v=1 by selecting the "state_employees" in the tagging filter at the bottom of the page.
  You may see references to E3 in this directory. This is the internal naming convention our team used to refer to the State Employees engagement. It refers to the "efficient, effective, and engaged" language in the Executive Order N-30-25.

## DBT Project structure (high level)
- **transform/**: dbt models and SQL transformations.
  - **dbt_project.yml**: dbt project configuration
  - **models/**: Subfolders in the `/transform/models` folder typically indicate the source or the engagement related to the model. For example, models in the subfolder `/transform/models/intermediate/ethelo_e3` are used for the *State Employees Efficiency Ideas* engagement.
    - **sources/**: source yml
    - **staging/**: models for preparing, cleaning and modularizing the source data tables. Generic transformations are applied here.
    - **intermediate/**: intermediate models containing transformations for more specific use cases that are still not intended for report consumption
    - **marts/**: marts models and reporting models intended for use by reporting and analytics tools
- **streamlit/**: Interactive dashboards are primarily built using Streamlit. These visualizations are generally intended for exploratory analysis and transparency rather than production reporting.
- **notebooks/**: analytics notebooks
- **docs/**: documentation

## Data Sources
The data used in this repository come primarily from delibrative democracy engagements conducted using *Ethelo*. Other data come from sources that such as *Bitly* and *Mailchimp* that were used for observing participation in the engagements and the effectiveness of marketing initiatives.

## Data Pipeline and Architecture
Raw source data is ingested into Snowflake before being transformed using dbt SQL models. We generally follow the CalData project architecture framework outlined [here](https://cagov.github.io/data-infrastructure/infra/architecture/).

## References and links
- dbt docs: https://docs.getdbt.com/
- Snowflake docs: https://docs.snowflake.com/
- Streamlit: https://streamlit.io/
