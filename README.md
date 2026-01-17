# CalData Engaged California

## Repository Overview
This repository contains data engineering and analytics workflows used for preparing, modeling, and presenting data assets used in the [Engaged California](https://engaged.ca.gov/) program.
The primary goal for making this repo public is to provide transparency into the analytics methods used to surface the insights in the published Engaged California reports.
The repository contains [dbt](https://docs.getdbt.com/docs/introduction) SQL models that transform source data into data sets ready for analytics and reporting. In addition to using dbt for SQL modeling, we use Snowflake as our data warehouse and Streamlit for generating interactive visualizations.

## Multiple Engagements
The Engaged California program has published reports from multiple engagements. These include:
- [Los Angeles Fire Recovery](https://engaged.ca.gov/lafires-recovery/)
  - [Agenda Setting Findings](https://engaged.ca.gov/lafires-recovery/agenda-setting-findings/)
  - [Agenda Setting Data Deep Dive](https://engaged.ca.gov/lafires-recovery/agenda-setting-data-insights/)
  - [Action Plan](https://engaged.ca.gov/lafires-recovery/action-plan/)
- [State Employee Efficiency Ideas](https://engaged.ca.gov/stateemployees/)
  - [Findings](https://e3-staging.pr.engaged.ca.gov/stateemployees/efficiency/)

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
