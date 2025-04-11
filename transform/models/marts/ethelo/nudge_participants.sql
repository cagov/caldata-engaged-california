
Select *
from {{ ref('int_participants')}} as a
where  joined_on is not null and LAST_SIGN_IN <= dateadd(day, -7, current_date()) and (COMPLETION != 100 or Completion is null)