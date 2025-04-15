Select *
From {{ ref('stg_participants') }}
Where
    joined_on Is Not null
    And last_sign_in <= dateadd(Day, -7, current_date())
    And (completion != 100 Or completion Is null)
