-- This model populates the department field for each participant based on their survey response and comment contents
-- It uses an LLM to fill in gaps where the survey response is missing or does not match a known department

{{ config(
    materialized='incremental',
    incremental_strategy='delete+insert',
    unique_key=['comment_id'],
    on_schema_change='sync_all_columns'
) }}

with
comments as (
    select *
    from {{ ref('stg_ethelo_e3_comments') }}
    where reply_to_id is null  --only top level comments (ideas)
),

dept_responses as (
    select
        participant_id,
        answer as department
    from {{ ref('stg_ethelo_e3_survey') }}
    where question = 'Share your idea - Which department or agency does your idea apply to?'
),

dropdown_choices as (
    select distinct id as known_department
    from {{ ref('stg_ethelo_e3_department_dropdown') }}
),

--this join will duplicate some comments
--this join ignores some dept responses that do not have an associated comment
--these are cases where the participant id has a dept_response, but there is no associated idea
--TO DO: investigate why there are dept_responses that have no comment

comments_with_depts as (
    select
        c.posted_by_id,
        c.comment_id,
        dr.department,
        c.comment_content,
        dc.known_department
    from comments as c
    left join dept_responses as dr on c.posted_by_id = dr.participant_id
    left join dropdown_choices as dc on dr.department = dc.known_department
),

fill_in_dept as (
--fill in department gaps for those comments without a department provided
--or where the department provided doesn't match a dropdown value
    select
        posted_by_id,
        comment_id,
        department,
        comment_content,
        coalesce(
            known_department,
            ai_complete(
                --model => 'mixtral-8x7b',
                --model => 'claude-4-sonnet',
                model => '{{ var("llm_model") }}',
                prompt => concat(
                    'Use the comment and user specified department below to return the relevant
                    California agency (or agencies). \n\n',
                    'IMPORTANT: Your output should be ONLY a single california agency or a comma separated string,
                    ex:California Agency (CA),Another Cal Department (ACD),...\n\n',

                    'Comment: ', coalesce(comment_content, '[No Content]'), '\n\n',
                    'User Specified Department: ', coalesce(department, '[No Content]'), '\n\n',
                    -->>>>>TO DO: just pass the relevant list of comments, no need to send rows with no content

                    'For context the following JSON outlines the California State government org structure: {
  "california_government": {
    "elected": [
      "STATE SUPERINTENDENT OF PUBLIC INSTRUCTION",
      "INSURANCE COMMISSIONER (CDI)",
      "SECRETARY OF STATE (SOS)",
      "LIEUTENANT GOVERNOR (LTG)",
      "ATTORNEY GENERAL",
      "STATE CONTROLLER\'S OFFICE (SCO)",
      "STATE TREASURER\'S OFFICE (STO)",
      "STATE BOARD OF EQUALIZATION (BOE)"
    ],
    "governor": {
      "staff": [
        "APPOINTMENTS SECRETARY",
        "DEPUTY CHIEF OF STAFF",
        "JUDICIAL APPOINTMENTS SECRETARY",
        "DIRECTOR OF OPERATIONS",
        "CHIEF OF STAFF",
        "CABINET SECRETARY",
        "DEPUTY CHIEF OF STAFF & SENIOR COUNSELOR ON INFRASTRUCTURE",
        "LEGAL AFFAIRS SECRETARY",
        "SENIOR ADVISOR FOR COMMUNICATIONS",
        "FIRST PARTNER CHIEF OF STAFF",
        "LEGISLATIVE AFFAIRS SECRETARY",
        "TRIBAL AFFAIRS SECRETARY"
      ],
      "direct": [
        "STATE LIBRARY (CSL)",
        "BOARD OF STATE AND COMMUNITY CORRECTIONS (California Board of State and Community Corrections)",
        "DELTA STEWARDSHIP COUNCIL (Deltacounc)",
        "CALIFORNIA ARTS COUNCIL (CAC)",
        "OFFICE OF THE STATE PUBLIC DEFENDER",
        "MILITARY DEPARTMENT (CalGuard)",
        "OFFICE OF BUSINESS AND ECONOMIC DEVELOPMENT (Go-Biz)",
        "OFFICE OF EMERGENCY SERVICES (Cal OES)",
        "OFFICE OF PLANNING & RESEARCH (OPR)",
        "CALIFORNIA VOLUNTEERS (CalVolunte)"
      ],
      "agencies": {
        "TRANSPORTATION AGENCY": [
          "CALIFORNIA HIGHWAY PATROL (CHP)",
          "DEPARTMENT OF MOTOR VEHICLES (DMV)",
          "DEPARTMENT OF TRANSPORTATION (Caltrans)",
          "HIGH SPEED RAIL AUTHORITY (CAHSRA)",
          "CA TRANSPORTATION COMMISSION (CTC)",
          "BOARD OF PILOT COMMISSIONERS (BOPC)"
        ],
        "DEPT OF CORRECTIONS & REHABILITATION": [
          "DIVISION OF ADULT INSTITUTIONS",
          "DIVISION OF ADULT PAROLE OPERATIONS",
          "DIVISION OF REHABILITATIVE PROGRAMS",
          "BOARD OF PAROLE HEARINGS (BPH)"
        ],
        "ENVIRONMENTAL PROTECTION AGENCY (CalEPA)": [
          "AIR RESOURCES BOARD (CARB)",
          "DEPARTMENT OF PESTICIDE REGULATION (CDPR)",
          "DEPARTMENT OF TOXIC SUBSTANCES CONTROL (DTSC)",
          "OFFICE OF ENVIRONMENTAL HEALTH HAZARD ASSESSMENT (OEHHA)",
          "STATE WATER RESOURCES CONTROL BOARD (SWRCB)",
          "DEPARTMENT OF RESOURCES RECYCLING & RECOVERY (CalRecycle)"
        ],
        "DEPARTMENT OF FINANCE (DOF)": [],
        "HEALTH & HUMAN SERVICES AGENCY (CHHS)": [
          "DEPARTMENT OF AGING (AGING)",
          "DEPARTMENT OF CHILD SUPPORT (DCSS)",
          "DEPARTMENT OF DEVELOPMENTAL SERVICES (DDS)",
          "DEPARTMENT OF PUBLIC HEALTH (CDPH)",
          "DEPARTMENT OF COMMUNITY SERVICES & DEVELOPMENT (CSD)",
          "EMERGENCY MEDICAL SERVICES AUTHORITY (EMSA)",
          "DEPARTMENT OF HEALTH CARE SERVICES (DHCS)",
          "DEPARTMENT OF MANAGED HEALTH CARE (DMHC)",
          "DEPARTMENT OF STATE HOSPITALS (DSH)",
          "DEPARTMENT OF SOCIAL SERVICES (CDSS)",
          "OFFICE OF THE SURGEON GENERAL (OSG)",
          "CENTER FOR DATA INSIGHTS & INNOVATION",
          "DEPARTMENT OF REHABILITATION (DOR)",
          "DEPARTMENT OF HEALTH CARE ACCESS & INFORMATION (HCAI)",
          "OFFICE OF YOUTH & COMMUNITY RESTORATION"
        ],
        "DEPARTMENT OF FOOD AND AGRICULTURE (CDFA)": [
          "AGRICULTURAL LABOR RELATIONS BOARD (ALRB)"
        ],
        "LABOR & WORKFORCE DEVELOPMENT AGENCY (LWDA)": [
          "EMPLOYMENT DEVELOPMENT DEPARTMENT (EDD)",
          "DEPARTMENT OF INDUSTRIAL RELATIONS (DIR)",
          "PUBLIC EMPLOYMENT RELATIONS BOARD (PERB)",
          "DEPARTMENT OF HUMAN RESOURCES (CalHR)",
          "CA UNEMPLOYMENT INSURANCE APPEALS BOARD (CUIAB)",
          "WORKFORCE DEVELOPMENT BOARD (CWDB)",
          "EMPLOYMENT TRAINING PANEL (ETP)"
        ],
        "NATURAL RESOURCES AGENCY (CNRA)": [
          "DEPARTMENT OF WATER RESOURCES (DWR)",
          "DEPARTMENT OF CONSERVATION (DOC)",
          "CALIFORNIA CONSERVATION CORPS (CCC)",
          "DEPARTMENT OF FORESTRY & FIRE PROTECTION (CAL FIRE)",
          "DEPARTMENT OF PARKS & RECREATION (PARKS)",
          "DEPARTMENT OF FISH & WILDLIFE (CDFW)",
          "CALIFORNIA COASTAL COMMISSION (Coastal)",
          "CALIFORNIA ENERGY COMMISSION (CEC)",
          "STATE LANDS COMMISSION (SLC)",
          "EXPOSITION PARK",
          "CALIFORNIA SCIENCE CENTER (CSC)",
          "CA AFRICAN AMERICAN MUSEUM",
          "CA Coastal Conservancy (SCC)",
          "CA Tahoe Conservancy (Tahoe)",
          "Santa Monica Mountains Conservancy (SMMC)",
          "Sacramento-San Joaquin Delta Conservancy (SSJDC)",
          "Sierra Nevada Conservancy (SNC)",
          "NATIVE AMERICAN HERITAGE COMMISSION (NAHC)",
          "WILDLIFE CONSERVATION BOARD (WCB)",
          "CENTRAL VALLEY FLOOD PROTECTION BOARD (CVFPB)",
          "SF BAY CONSERVATION AND DEVELOPMENT COMMISSION (BCDC)",
          "CALIFORNIA WATER COMMISSION (CWC)",
          "COLORADO RIVER BOARD OF CALIFORNIA (CRB)"
        ],
        "GOVERNMENT OPERATIONS AGENCY (GovOps)": [
          "FRANCHISE TAX BOARD (FTB)",
          "DEPARTMENT OF TECHNOLOGY (CDT)",
          "VICTIM COMPENSATION BOARD (CalVCB)",
          "DEPARTMENT OF GENERAL SERVICES (DGS)",
          "OFFICE OF ADMINISTRATIVE LAW (OAL)",
          "DEPARTMENT OF TAX & FEE ADMINISTRATION (CDTFA)",
          "OFFICE OF TAX APPEALS (OTA)",
          "STATE PERSONNEL BOARD (SPB)",
          "PUBLIC EMPLOYEES\' RETIREMENT SYSTEM (CALPERS)",
          "TEACHERS\' RETIREMENT SYSTEM (CalSTRS)",
          "OFFICE OF DATA & INNOVATION (ODI)",
          "DEPARTMENT OF FINANCIAL INFORMATION SYSTEM FOR CALIFORNIA (FI$CAL)",
          "CA CIVIL RIGHTS DEPARTMENT (CRD)"
        ],
        "BUSINESS, CONSUMER SERVICES & HOUSING AGENCY (BCSH)": [
          "DEPARTMENT OF ALCOHOLIC BEVERAGE CONTROL (ABC)",
          "DEPARTMENT OF CANNABIS CONTROL (DCC)",
          "DEPARTMENT OF CONSUMER AFFAIRS (DCA)",
          "ALCOHOLIC BEVERAGE CONTROL APPEALS BOARD (ABCAB)",
          "CA HORSE RACING BOARD (CHRB)",
          "DEPARTMENT OF FINANCIAL PROTECTION & INNOVATION (DFPI)",
          "DEPARTMENT OF HOUSING & COMMUNITY DEVELOPMENT (HCD)",
          "CA HOUSING FINANCE AGENCY (CALHFA)",
          "DEPARTMENT OF REAL ESTATE (DRE)",
          "CANNABIS CONTROL APPEALS PANEL (CCAP)"
        ],
        "DEPARTMENT OF VETERANS AFFAIRS (CalVet)": []
      }
    },
    "independent": [
      "FAIR POLITICAL PRACTICES COMMISSION (FPPC)",
      "COMMISSION ON PEACE OFFICER STANDARDS AND TRAINING (POST)",
      "CA COMMUNITY COLLEGES BOARD OF GOVERNORS (CCCCO)",
      "CALIFORNIA STATE BOARD OF EDUCATION (SBE)",
      "CALIFORNIA GAMBLING CONTROL COMMISSION (CGCC)",
      "CALIFORNIA STATE LOTTERY (CALottery)",
      "CALIFORNIA STATE UNIVERSITY BOARD OF TRUSTEES (CSU)",
      "OFFICE OF THE INSPECTOR GENERAL (OIG)",
      "UNIVERSITY OF CALIFORNIA BOARD OF REGENTS (UC)",
      "PUBLIC UTILITIES COMMISSION (CPUC)",
      "STUDENT AID COMMISSION (CSAC)"
    ]
  }
}\n\n',

                    'ACRONYMS TO LOOK FOR:\n',
                    'CNRA, DGS, CDPH, DSH, CDT, CDA, CDTFA, CalHR, SCO, ODI, SPB, HCAI, DMHC, CDSS, DHCS,
                    DDS, CCC, CEC, DWR, SCC, DOC, FTB, OAL, DMV, EDD, DOF, CALTRANS, ARB, CDPR, CAL FIRE,
                    CDFW, HCD, CDE, DIR, DCA, CalPERS, BOE, CPUC, Cal OES, EMSA, DTSC, CalVet, CHHS, CalHHS,
                    BCSH, LWDA, GovOps, FI$Cal, CDFA, CDCR\n\n',

                    'INSTRUCTIONS:\n',
                    '• Look for agency full names and acronyms in the comment and in the user specified department\n',
                    '• Return all agencies that are specifically mentioned in the comment or the user specified
                    department (can be multiple)\n',
                    '• Do not list multiple agencies unless they are specifically mentioned by name or acronym
                    in the comment or user specified department.\n',
                    '• If no specific agency mentions are found, then, if possible, provide the single most relevant
                    agency based on the comment\n',
                    '• If the comment or user specified department applies to all or most agencies,
                    return "Affects multiple departments"\n',
                    '• If it is not possible to determine a relevant agency, then return UNSPECIFIED',

                    'EXAMPLES:\n',
                    'CDT authentication → California Department of Technology (CDT)\n',
                    'CalHR and Spb processes → Department of Human Resources (CalHR),State Personnel Board (SPB)\n',
                    'dept of food and agriculture → Department of Food and Agriculture (CDFA)\n',
                    'Cannabis program  → Department of Cannabis Control (DCC)\n',
                    'Need more help from leadership → UNSPECIFIED\n',
                    'Probably all of them → Affects multiple departments\n\n',

                    --'Return ONLY JSON: {"agencies": ["AGENCY1", "AGENCY2"]}'
                    'IMPORTANT: Your output must be ONLY a single california agency or a comma separated string,
                    ex:California Agency (CA),Another Cal Department (ACD),...'
                ),
                model_parameters => object_construct(
                    'temperature', 0.05,
                    'max_tokens', 100,
                    'top_p', 0.05
                )
            )
        ) as departments
    from comments_with_depts
),

agg_to_single_dept_list_per_comment as (
    select
        comment_id,
        array_to_string(
            array_distinct(
                array_flatten(
                    array_agg(split(departments, ','))
                )
            ), ', '
        ) as department_list
    from fill_in_dept
    group by comment_id
)

select * from agg_to_single_dept_list_per_comment
