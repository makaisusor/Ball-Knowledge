-- Ball Knowledge: signed-in MLB Letter of the Day persistence
-- Run once in the Supabase SQL Editor for the project used by index.html.
-- Safe to re-run. Daily challenges use the UTC calendar date.
--
-- This stores server-timed daily attempts per authenticated account, but the
-- server does not yet have the complete MLB roster to independently validate
-- that submitted player IDs are genuine. Do not enable public, prize-bearing
-- leaderboards until authoritative server-side player validation is added.

CREATE TABLE IF NOT EXISTS public.bk_daily_attempts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_date date NOT NULL,
  letter text NOT NULL CHECK (letter ~ '^[A-Z]$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(answers) = 'array'),
  completed_at timestamptz,
  PRIMARY KEY (user_id, challenge_date)
);

ALTER TABLE public.bk_daily_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bk_daily_attempts FROM anon, authenticated;
GRANT SELECT ON TABLE public.bk_daily_attempts TO authenticated;

DROP POLICY IF EXISTS "bk_daily_own_attempts" ON public.bk_daily_attempts;
CREATE POLICY "bk_daily_own_attempts"
ON public.bk_daily_attempts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Server starts the one and only scored attempt for today. A refresh or a
-- second device returns the same attempt and the same original deadline.
CREATE OR REPLACE FUNCTION public.bk_daily_begin(p_day date)
RETURNS public.bk_daily_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_letters text[] := ARRAY['M','S','A','J','B','C','D','R','T','P','L','E','K','F','G','H','N','W','O','V'];
  v_letter text;
  v_row public.bk_daily_attempts;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to save a daily attempt'; END IF;
  IF p_day IS NULL OR p_day <> v_today THEN RAISE EXCEPTION 'Only today''s challenge can be started'; END IF;
  v_letter := v_letters[1 + ((p_day - date '1970-01-01') % array_length(v_letters,1))];

  INSERT INTO public.bk_daily_attempts (user_id, challenge_date, letter, ends_at)
  VALUES (v_user, p_day, v_letter, now() + interval '120 seconds')
  ON CONFLICT (user_id, challenge_date) DO NOTHING;

  -- Expire unfinished attempts after the original two-minute window.
  UPDATE public.bk_daily_attempts
  SET completed_at = ends_at
  WHERE user_id = v_user AND challenge_date = p_day
    AND completed_at IS NULL AND ends_at <= now();

  SELECT * INTO v_row FROM public.bk_daily_attempts
  WHERE user_id = v_user AND challenge_date = p_day;
  RETURN v_row;
END;
$$;

-- Append an accepted name. Only this security-definer RPC can change score
-- records; clients cannot directly edit rows or lengthen deadlines.
-- TODO before public leaderboards: verify p_player_id and the normalized name
-- against an authoritative server-side historical MLB roster.
CREATE OR REPLACE FUNCTION public.bk_daily_answer(
  p_day date, p_player_id text, p_player_name text, p_first_name text
)
RETURNS public.bk_daily_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.bk_daily_attempts;
  v_initial text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to save your answer'; END IF;
  SELECT * INTO v_row FROM public.bk_daily_attempts
  WHERE user_id = v_user AND challenge_date = p_day FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Start your daily challenge first'; END IF;
  IF v_row.completed_at IS NOT NULL OR now() >= v_row.ends_at THEN
    UPDATE public.bk_daily_attempts SET completed_at = COALESCE(completed_at, ends_at)
    WHERE user_id = v_user AND challenge_date = p_day AND completed_at IS NULL;
    RAISE EXCEPTION 'Your daily attempt has ended';
  END IF;

  IF p_player_id IS NULL OR length(p_player_id) NOT BETWEEN 3 AND 45
    OR p_player_id !~ '^[A-Za-z0-9_-]+$'
    OR p_player_name IS NULL OR length(trim(p_player_name)) NOT BETWEEN 3 AND 100
    OR p_first_name IS NULL OR length(trim(p_first_name)) NOT BETWEEN 1 AND 80
  THEN RAISE EXCEPTION 'Invalid player answer'; END IF;

  -- Respect the day's first-name letter (including common accent marks).
  v_initial := upper(left(translate(trim(p_first_name),
    'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖáéíóúüñàèìòùâêîôûäëïö',
    'AEIOUUNAEIOUAEIOUAEIOaeiouunaeiouaeiouaeio'),1));
  IF v_initial <> v_row.letter THEN RAISE EXCEPTION 'Wrong first-name letter'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_row.answers) a
    WHERE a->>'id' = p_player_id
  ) THEN RAISE EXCEPTION 'You already named this player'; END IF;
  IF jsonb_array_length(v_row.answers) >= 150 THEN RAISE EXCEPTION 'Maximum answer limit reached'; END IF;

  UPDATE public.bk_daily_attempts
  SET answers = answers || jsonb_build_array(jsonb_build_object('id',p_player_id,'name',trim(p_player_name)))
  WHERE user_id = v_user AND challenge_date = p_day
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.bk_daily_complete(p_day date)
RETURNS public.bk_daily_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.bk_daily_attempts;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to finish a daily attempt'; END IF;
  UPDATE public.bk_daily_attempts
  SET completed_at = COALESCE(completed_at, now())
  WHERE user_id = v_user AND challenge_date = p_day
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Daily attempt not found'; END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.bk_daily_begin(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bk_daily_answer(date,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bk_daily_complete(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bk_daily_begin(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bk_daily_answer(date,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bk_daily_complete(date) TO authenticated;
