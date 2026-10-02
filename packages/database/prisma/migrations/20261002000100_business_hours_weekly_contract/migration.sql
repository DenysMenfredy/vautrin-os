-- Move persisted V1 flat weekday entries under the approved `weekly` key.
-- The JSONB default `{}` remains an unconfigured profile; it is not a schedule.
-- Preserve any unrelated keys so a migration never discards operator data.
UPDATE public.business_profiles
SET business_hours =
  (business_hours - ARRAY[
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday'
  ]) || jsonb_build_object(
    'weekly', jsonb_build_object(
      'monday', business_hours->'monday',
      'tuesday', business_hours->'tuesday',
      'wednesday', business_hours->'wednesday',
      'thursday', business_hours->'thursday',
      'friday', business_hours->'friday',
      'saturday', business_hours->'saturday',
      'sunday', business_hours->'sunday'
    )
  )
WHERE jsonb_typeof(business_hours) = 'object'
  AND business_hours ? 'timezone'
  AND business_hours ?& ARRAY[
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday'
  ]
  AND NOT (business_hours ? 'weekly');

-- Practical rollback for records not subsequently edited in the new shape:
-- UPDATE public.business_profiles
-- SET business_hours = (business_hours - 'weekly') || (business_hours->'weekly')
-- WHERE business_hours ? 'weekly';
