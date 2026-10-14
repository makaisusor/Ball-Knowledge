-- Install this after supabase/private-multiplayer.sql.
-- An incorrect answer immediately eliminates the current player.
CREATE OR REPLACE FUNCTION public.eliminate_private_player(p_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.game_rooms%ROWTYPE; me public.room_players%ROWTYPE; removed uuid[]; survivor uuid; remaining integer; next_seat integer;
BEGIN
 SELECT * INTO r FROM public.game_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'playing' THEN RAISE EXCEPTION 'Game is not active'; END IF;
 SELECT * INTO me FROM public.room_players WHERE room_id=p_room_id AND user_id=auth.uid();
 IF NOT FOUND OR me.seat_number IS DISTINCT FROM r.current_seat THEN RAISE EXCEPTION 'Not your turn'; END IF;
 IF clock_timestamp()>=r.turn_deadline THEN RAISE EXCEPTION 'Turn has already expired'; END IF;
 removed:=array_append(r.eliminated_user_ids,me.user_id);
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
REVOKE ALL ON FUNCTION public.eliminate_private_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminate_private_player(uuid) TO authenticated;
