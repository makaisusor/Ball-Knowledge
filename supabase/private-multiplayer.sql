-- Ball Knowledge private online multiplayer. Run once in Supabase SQL Editor.
-- Preserves existing rooms and members; extends start_private_game.
ALTER TABLE public.game_rooms
 ADD COLUMN IF NOT EXISTS current_seat integer,
 ADD COLUMN IF NOT EXISTS turn_deadline timestamptz,
 ADD COLUMN IF NOT EXISTS used_player_ids text[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS answer_history jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS eliminated_user_ids uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS last_letter text,
 ADD COLUMN IF NOT EXISTS winner_user_id uuid;

CREATE OR REPLACE FUNCTION public.start_private_game(p_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.game_rooms%ROWTYPE; n integer;
BEGIN
 SELECT * INTO r FROM public.game_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
 IF auth.uid() IS DISTINCT FROM r.host_id THEN RAISE EXCEPTION 'Only the host can start'; END IF;
 IF r.status <> 'waiting' THEN RAISE EXCEPTION 'Room already started'; END IF;
 SELECT count(*) INTO n FROM public.room_players WHERE room_id=p_room_id;
 IF n<2 THEN RAISE EXCEPTION 'At least two players required'; END IF;
 UPDATE public.game_rooms SET status='playing',
 current_seat=(SELECT min(seat_number) FROM public.room_players WHERE room_id=p_room_id),
 turn_deadline=clock_timestamp()+make_interval(secs=>r.timer_seconds),
 used_player_ids='{}',answer_history='[]'::jsonb,eliminated_user_ids='{}',
 last_letter=NULL,winner_user_id=NULL WHERE id=p_room_id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.get_private_game(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.game_rooms%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.room_players WHERE room_id=p_room_id AND user_id=auth.uid())
 THEN RAISE EXCEPTION 'Not a room member'; END IF;
 SELECT * INTO r FROM public.game_rooms WHERE id=p_room_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
 SELECT jsonb_build_object('status',r.status,'room_code',r.room_code,'timer_seconds',r.timer_seconds,
 'current_seat',r.current_seat,'turn_deadline',r.turn_deadline,'last_letter',r.last_letter,
 'history',r.answer_history,'winner_user_id',r.winner_user_id,'eliminated_user_ids',to_jsonb(r.eliminated_user_ids),
 'players',COALESCE(jsonb_agg(jsonb_build_object('id',rp.user_id,'name',rp.display_name,'seat',rp.seat_number)
 ORDER BY rp.seat_number),'[]'::jsonb))
 INTO result FROM public.room_players rp WHERE rp.room_id=p_room_id;
 RETURN result;
END $$;

-- Lock the room for every turn update. The server enforces deadlines, turn ownership,
-- no-repeat IDs and the chain rule. The submitted ID/name must be checked against
-- an authoritative player catalogue before ranked or public competitive release.
CREATE OR REPLACE FUNCTION public.submit_private_answer(p_room_id uuid,p_player_id text,p_first_name text,p_last_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.game_rooms%ROWTYPE; me public.room_players%ROWTYPE; first_letter text; next_letter text; next_seat integer;
BEGIN
 SELECT * INTO r FROM public.game_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'playing' THEN RAISE EXCEPTION 'Game is not active'; END IF;
 SELECT * INTO me FROM public.room_players WHERE room_id=p_room_id AND user_id=auth.uid();
 IF NOT FOUND OR me.seat_number IS DISTINCT FROM r.current_seat THEN RAISE EXCEPTION 'Not your turn'; END IF;
 IF clock_timestamp()>=r.turn_deadline THEN RAISE EXCEPTION 'Time expired'; END IF;
 IF p_player_id IS NULL OR length(p_player_id)>100 OR length(trim(p_player_id))<1
 OR length(trim(coalesce(p_first_name,'')))<1 OR length(trim(coalesce(p_last_name,'')))<1
 OR length(p_first_name)>100 OR length(p_last_name)>100 THEN RAISE EXCEPTION 'Invalid player'; END IF;
 IF p_player_id=ANY(r.used_player_ids) THEN RAISE EXCEPTION 'Player already used'; END IF;
 first_letter:=upper(left(regexp_replace(p_first_name,'^[^a-zA-Z]*','','g'),1));
 next_letter:=upper(left(regexp_replace(p_last_name,'^[^a-zA-Z]*','','g'),1));
 -- The next letter is the last alphabetic character of the surname.
 next_letter:=upper(right(regexp_replace(p_last_name,'[^a-zA-Z]','','g'),1));
 IF first_letter='' OR next_letter='' THEN RAISE EXCEPTION 'Invalid name'; END IF;
 IF r.last_letter IS NOT NULL AND first_letter<>r.last_letter THEN RAISE EXCEPTION 'Wrong starting letter'; END IF;
 SELECT min(seat_number) INTO next_seat FROM public.room_players
 WHERE room_id=p_room_id AND seat_number>r.current_seat AND NOT (user_id=ANY(r.eliminated_user_ids));
 IF next_seat IS NULL THEN SELECT min(seat_number) INTO next_seat FROM public.room_players
 WHERE room_id=p_room_id AND NOT (user_id=ANY(r.eliminated_user_ids)); END IF;
 UPDATE public.game_rooms SET used_player_ids=array_append(r.used_player_ids,p_player_id),
 answer_history=r.answer_history||jsonb_build_array(jsonb_build_object('player_id',p_player_id,
 'name',trim(p_first_name)||' '||trim(p_last_name),'by',me.display_name,'seat',me.seat_number)),
 last_letter=next_letter,current_seat=next_seat,
 turn_deadline=clock_timestamp()+make_interval(secs=>r.timer_seconds) WHERE id=p_room_id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.expire_private_turn(p_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.game_rooms%ROWTYPE; loser uuid; survivor uuid; remaining integer; next_seat integer; removed uuid[];
BEGIN
 SELECT * INTO r FROM public.game_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'playing' THEN RETURN false; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.room_players WHERE room_id=p_room_id AND user_id=auth.uid())
 THEN RAISE EXCEPTION 'Not a room member'; END IF;
 IF clock_timestamp()<r.turn_deadline THEN RETURN false; END IF;
 SELECT user_id INTO loser FROM public.room_players WHERE room_id=p_room_id AND seat_number=r.current_seat;
 removed:=array_append(r.eliminated_user_ids,loser);
 SELECT count(*),min(user_id) INTO remaining,survivor FROM public.room_players
 WHERE room_id=p_room_id AND NOT (user_id=ANY(removed));
 IF remaining<=1 THEN
 UPDATE public.game_rooms SET status='finished',eliminated_user_ids=removed,
 winner_user_id=survivor,turn_deadline=NULL WHERE id=p_room_id;
 ELSE
 SELECT min(seat_number) INTO next_seat FROM public.room_players
 WHERE room_id=p_room_id AND seat_number>r.current_seat AND NOT (user_id=ANY(removed));
 IF next_seat IS NULL THEN SELECT min(seat_number) INTO next_seat FROM public.room_players
 WHERE room_id=p_room_id AND NOT (user_id=ANY(removed)); END IF;
 UPDATE public.game_rooms SET eliminated_user_ids=removed,current_seat=next_seat,
 turn_deadline=clock_timestamp()+make_interval(secs=>r.timer_seconds) WHERE id=p_room_id;
 END IF;
 RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.get_private_game(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_private_answer(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_private_turn(uuid) TO authenticated;
