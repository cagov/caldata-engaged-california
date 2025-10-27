-- The purpose of this model is to map the hand labels that the UX team created
-- per comment back to their comment ID, for further processing.

with hand_labels as (
SELECT
  a.participant_id,
  b.main_idea,
  a.main_idea_type,
  a.main_idea_primary_theme,
  a.main_idea_primary_subthemes as main_idea_subthemes

FROM
  {{ ref('stg_e3_hand_labelled_main_ideas') }} a
left join {{ ref('e3_participant_responses') }} b
/* this join is necessary because:
    1) this mart is where the original pull sent to the UX team came from, and is one-row-per-participant_id
    2) the only ID we have is participant_id, and we want to ensure we are mapping one-to-one with responses,
        this is the safest way to do that, given the Main Idea content might have been modified in the
        process of going from Snowflake -> Coda -> CSV -> Snowflake
    3) this will help us get the Main Idea content in correctly for our join back to the comments
        table below
        */
 on
a.participant_id = b.participant_id
)

select
a.*,
b.main_idea_type,
b.main_idea_primary_theme,
b.main_idea_subthemes

from {{ ref('int_ethelo_e3_comments_and_responses') }} a
join hand_labels b
on a.participant_id = b.participant_id and a.content = b.main_idea
