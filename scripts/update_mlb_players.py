
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

YEAR = 2026
OUTPUT = Path("mlb-players-latest.json")
API = "https://statsapi.mlb.com/api/v1/stats"


def fetch_json(params):
    url = API + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "BallKnowledge/1.0"}
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def main():
    players = {}

    for group in ("hitting", "pitching", "fielding"):
        offset = 0
        limit = 1000

        while True:
            data = fetch_json({
                "stats": "season",
                "group": group,
                "sportIds": 1,
                "season": YEAR,
                "limit": limit,
                "offset": offset,
            })

            splits = [
                split
                for stat in data.get("stats", [])
                for split in stat.get("splits", [])
            ]

            for split in splits:
                player = split.get("player", {})
                stat = split.get("stat", {})

                if int(stat.get("gamesPlayed") or 0) <= 0:
                    continue

                player_id = player.get("id")
                name = player.get("fullName")

                if player_id and name:
                    players[str(player_id)] = {
                        "mlbId": player_id,
                        "name": name,
                    }

            if len(splits) < limit:
                break

            offset += limit

    if not players:
        raise RuntimeError(
            "No 2026 MLB players returned. "
            "Existing data will not be overwritten."
        )

    result = {
        "season": YEAR,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "players": sorted(
            players.values(),
            key=lambda p: p["name"]
        ),
    }

    OUTPUT.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Saved {len(players)} MLB players for {YEAR}")


if __name__ == "__main__":
    main()
