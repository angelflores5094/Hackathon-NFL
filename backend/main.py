"""
Side Quest — NFL Big Data Bowl UNAM 2026
Tracking real (ThompsonJamesBliss regional event data) + Separation Burst Index.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


def cargar_env() -> None:
    f = Path(__file__).resolve().parent.parent / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8-sig").splitlines():
            linea = linea.strip()
            if linea and not linea.startswith("#") and "=" in linea:
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


cargar_env()

app = FastAPI(title="Separation Lab — BDB Side Quest", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

TRACK: pd.DataFrame = pd.DataFrame()
PLAYS: pd.DataFrame = pd.DataFrame()
FIELD_X, FIELD_Y = 120.0, 53.3


@app.on_event("startup")
def startup() -> None:
    global TRACK, PLAYS
    tracking_path = DATA / "tracking.csv"
    if not tracking_path.exists():
        tracking_path = DATA / "tracking_sample.csv"

    players_path = DATA / "players.csv"
    plays_path = DATA / "plays.csv"
    if not plays_path.exists():
        plays_path = DATA / "plays_sample.csv"

    if tracking_path.exists():
        TRACK = pd.read_csv(tracking_path, low_memory=False)
        print(f"[data] tracking: {tracking_path.name} ({len(TRACK):,} rows)")
    else:
        TRACK = pd.DataFrame()
        print("[data] NO tracking file")

    if not TRACK.empty:
        for c in ("x", "y", "s", "a", "dis", "o", "dir"):
            if c in TRACK.columns:
                TRACK[c] = pd.to_numeric(TRACK[c], errors="coerce")
        for c in ("frameId", "playId", "nflId", "jerseyNumber", "gameId"):
            if c in TRACK.columns:
                TRACK[c] = pd.to_numeric(TRACK[c], errors="coerce")

        # tiempo relativo por jugada (10 Hz)
        TRACK["time"] = (TRACK["frameId"] - 1) * 0.1

        # unir nombres y posiciones
        if players_path.exists():
            pl = pd.read_csv(players_path)
            pl = pl.rename(columns={"officialPosition": "position", "displayName": "displayName"})
            cols = ["nflId"]
            if "displayName" in pl.columns:
                cols.append("displayName")
            if "position" in pl.columns:
                cols.append("position")
            TRACK = TRACK.merge(pl[cols], on="nflId", how="left")
        if "displayName" not in TRACK.columns:
            TRACK["displayName"] = TRACK["nflId"].astype(str)
        if "position" not in TRACK.columns:
            TRACK["position"] = None
        # balón
        TRACK.loc[TRACK["team"] == "football", "displayName"] = "football"
        TRACK.loc[TRACK["team"] == "football", "position"] = "ball"

    if plays_path.exists():
        PLAYS = pd.read_csv(plays_path, low_memory=False)
        if not TRACK.empty and "gameId" in PLAYS.columns:
            gids = set(TRACK["gameId"].unique())
            PLAYS = PLAYS[PLAYS["gameId"].isin(gids)]
        print(f"[data] plays: {len(PLAYS):,}")
    else:
        PLAYS = pd.DataFrame()


def nearest_defender_distance(
    frame: pd.DataFrame, offense_id: int, offense_team: str
) -> tuple[float, Optional[int], Optional[str]]:
    off = frame[frame["nflId"] == offense_id]
    if off.empty:
        return float("nan"), None, None
    ox, oy = float(off.iloc[0]["x"]), float(off.iloc[0]["y"])
    defs = frame[
        (frame["team"] != offense_team)
        & (frame["team"] != "football")
        & (frame["nflId"] != offense_id)
    ]
    if defs.empty:
        return float("nan"), None, None
    dists = np.sqrt((defs["x"] - ox) ** 2 + (defs["y"] - oy) ** 2)
    i = int(dists.idxmin())
    row = defs.loc[i]
    return float(dists.min()), int(row["nflId"]), str(row.get("displayName", row["nflId"]))


def compute_sbi(play_track: pd.DataFrame, target_id: int, offense_team: str) -> dict[str, Any]:
    t = play_track[play_track["nflId"] == target_id].sort_values("frameId")
    if t.empty:
        return {"error": "target not in play"}

    snap_frames = play_track[play_track["event"] == "ball_snap"]["frameId"]
    snap_f = int(snap_frames.min()) if len(snap_frames) else int(t["frameId"].min())

    catch_frames = play_track[
        play_track["event"].isin(["pass_arrived", "pass_outcome_caught"])
    ]["frameId"]
    catch_f = int(catch_frames.min()) if len(catch_frames) else None

    f_snap = play_track[play_track["frameId"] == snap_f]
    sep0, _, _ = nearest_defender_distance(f_snap, target_id, offense_team)

    t0 = float(t.loc[t["frameId"] == snap_f, "time"].iloc[0]) if snap_f in set(t["frameId"]) else 0.0
    cand = t[t["time"] >= t0 + 1.5]
    t15_f = int(cand["frameId"].min()) if len(cand) else int(t["frameId"].max())

    f_15 = play_track[play_track["frameId"] == t15_f]
    sep15, def15_id, def15_name = nearest_defender_distance(f_15, target_id, offense_team)

    sep_catch = None
    if catch_f is not None:
        f_c = play_track[play_track["frameId"] == catch_f]
        sep_catch, _, _ = nearest_defender_distance(f_c, target_id, offense_team)

    delta_sep = (sep15 - sep0) if (sep15 == sep15 and sep0 == sep0) else 0.0
    window = t[(t["frameId"] >= snap_f) & (t["frameId"] <= t15_f)]
    speed_avg = float(window["s"].mean()) if len(window) else 0.0

    if def15_id is not None:
        dwin = play_track[
            (play_track["nflId"] == def15_id)
            & (play_track["frameId"] >= snap_f)
            & (play_track["frameId"] <= t15_f)
        ]
        def_speed = float(dwin["s"].mean()) if len(dwin) else 0.0
    else:
        def_speed = 0.0

    speed_adv = speed_avg - def_speed
    catch_term = float(sep_catch) if sep_catch is not None and sep_catch == sep_catch else 0.0
    sbi = 0.6 * delta_sep + 0.3 * speed_adv + 0.1 * catch_term

    return {
        "metric": "Separation Burst Index (SBI)",
        "definition": (
            "Separación que gana el receptor en 1.5 s post-snap vs el defensor más cercano "
            "(Δ sep + ventaja de velocidad + sep al catch). <0 cubierta; 2–5 útil; >5 dominio."
        ),
        "target_id": int(target_id),
        "target_name": str(t.iloc[0].get("displayName", target_id)),
        "defender_at_burst": def15_name,
        "sep_at_snap": round(float(sep0), 2) if sep0 == sep0 else None,
        "sep_at_1_5s": round(float(sep15), 2) if sep15 == sep15 else None,
        "sep_at_catch": round(float(sep_catch), 2) if sep_catch is not None and sep_catch == sep_catch else None,
        "delta_separation": round(float(delta_sep), 2),
        "speed_avg_target": round(speed_avg, 2),
        "speed_avg_defender": round(def_speed, 2),
        "speed_advantage": round(float(speed_adv), 2),
        "sbi": round(float(sbi), 2),
        "snap_frame": snap_f,
        "burst_frame": t15_f,
        "catch_frame": catch_f,
    }


def separation_series(play_track: pd.DataFrame, target_id: int, offense_team: str) -> list[dict]:
    out = []
    for fid, frame in play_track.groupby("frameId"):
        sep, _, dname = nearest_defender_distance(frame, target_id, offense_team)
        tr = frame[frame["nflId"] == target_id]
        if tr.empty or sep != sep:
            continue
        out.append({
            "frameId": int(fid),
            "time": float(tr.iloc[0]["time"]) if pd.notna(tr.iloc[0]["time"]) else None,
            "separation": round(float(sep), 2),
            "target_speed": round(float(tr.iloc[0]["s"]), 2),
            "defender": dname,
        })
    return out


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/plays")
def list_plays(limit: int = Query(80, ge=1, le=500)) -> list[dict]:
    if PLAYS.empty:
        if TRACK.empty:
            return []
        g = (
            TRACK.groupby(["gameId", "playId"], as_index=False)
            .size()
            .rename(columns={"size": "frames"})
        )
        return g.head(limit).to_dict(orient="records")

    # Orden natural: por cuarto y reloj; preferir pases
    df = PLAYS.copy()
    sort_cols = [c for c in ["quarter", "gameClock", "playId"] if c in df.columns]
    if sort_cols:
        df = df.sort_values(sort_cols, ascending=True, na_position="last")
    cols = [
        c
        for c in [
            "gameId", "playId", "playDescription", "quarter", "gameClock",
            "down", "yardsToGo", "possessionTeam", "defensiveTeam",
            "passResult", "playResult", "offenseFormation", "pff_passCoverage",
        ]
        if c in df.columns
    ]
    return df[cols].head(limit).to_dict(orient="records")


@app.get("/api/play/{game_id}/{play_id}/frames")
def get_frames(game_id: int, play_id: int, frame: Optional[int] = Query(None)) -> dict:
    if TRACK.empty:
        raise HTTPException(503, "No hay tracking cargado")
    p = TRACK[(TRACK["gameId"] == game_id) & (TRACK["playId"] == play_id)].copy()
    if p.empty:
        raise HTTPException(404, "Jugada no encontrada en tracking")

    max_frame = int(p["frameId"].max())
    min_frame = int(p["frameId"].min())
    if frame is not None:
        p = p[p["frameId"] == frame]
        if p.empty:
            raise HTTPException(404, f"Frame {frame} no existe")

    players = []
    for _, r in p.iterrows():
        players.append({
            "nflId": int(r["nflId"]) if pd.notna(r["nflId"]) else None,
            "name": r["displayName"] if pd.notna(r.get("displayName")) else str(r.get("nflId")),
            "jersey": int(r["jerseyNumber"]) if pd.notna(r.get("jerseyNumber")) else None,
            "position": r["position"] if pd.notna(r.get("position")) else None,
            "team": r["team"],
            "x": float(r["x"]),
            "y": float(r["y"]),
            "s": float(r["s"]) if pd.notna(r["s"]) else 0,
            "a": float(r["a"]) if pd.notna(r["a"]) else 0,
            "o": float(r["o"]) if pd.notna(r["o"]) else 0,
            "dir": float(r["dir"]) if pd.notna(r["dir"]) else 0,
            "frameId": int(r["frameId"]),
            "event": r["event"] if pd.notna(r.get("event")) else None,
        })

    events = (
        TRACK[
            (TRACK["gameId"] == game_id)
            & (TRACK["playId"] == play_id)
            & (TRACK["event"].notna())
        ][["frameId", "event"]]
        .drop_duplicates()
        .sort_values("frameId")
        .to_dict(orient="records")
    )

    return {
        "gameId": game_id,
        "playId": play_id,
        "minFrame": min_frame,
        "maxFrame": max_frame,
        "field": {"x": FIELD_X, "y": FIELD_Y},
        "players": players,
        "events": events,
    }


@app.get("/api/play/{game_id}/{play_id}/sbi")
def get_sbi(game_id: int, play_id: int, target_id: Optional[int] = Query(None)) -> dict:
    if TRACK.empty:
        raise HTTPException(503, "No hay tracking")
    p = TRACK[(TRACK["gameId"] == game_id) & (TRACK["playId"] == play_id)]
    if p.empty:
        raise HTTPException(404, "Jugada no encontrada")

    play_meta: dict = {}
    if not PLAYS.empty:
        m = PLAYS[(PLAYS["gameId"] == game_id) & (PLAYS["playId"] == play_id)]
        if not m.empty:
            play_meta = m.iloc[0].to_dict()
            play_meta = {k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in play_meta.items()}

    offense = play_meta.get("possessionTeam")
    if not offense:
        vc = p[p["team"] != "football"]["team"].value_counts()
        offense = str(vc.index[0]) if len(vc) else ""

    # Candidatos ofensivos (WR / TE / RB) para el selector del dashboard
    skill = p[
        (p["team"] == offense)
        & (p["position"].isin(["WR", "TE", "RB", "FB", "HB"]))
    ]
    if skill.empty:
        skill = p[(p["team"] == offense) & (p["team"] != "football")]

    targets: list[dict] = []
    if not skill.empty:
        for nid, grp in skill.groupby("nflId"):
            row = grp.iloc[0]
            targets.append({
                "nflId": int(nid),
                "name": str(row.get("displayName", nid)),
                "position": str(row.get("position") or ""),
                "jersey": int(row["jerseyNumber"]) if pd.notna(row.get("jerseyNumber")) else None,
            })
        targets.sort(key=lambda t: (t["position"] or "Z", t["name"]))

    if target_id is None:
        if skill.empty:
            raise HTTPException(400, "No hay jugadores ofensivos")
        speeds = skill.groupby("nflId")["s"].max()
        target_id = int(speeds.idxmax())

    sbi = compute_sbi(p, int(target_id), str(offense))
    series = separation_series(p, int(target_id), str(offense))
    return {
        "play": play_meta,
        "sbi": sbi,
        "separation_series": series,
        "offense_team": offense,
        "targets": targets,
    }


@app.get("/api/summary")
def summary() -> dict:
    return {
        "tracking_rows": int(len(TRACK)),
        "plays": int(TRACK["playId"].nunique()) if not TRACK.empty else 0,
        "games": int(TRACK["gameId"].nunique()) if not TRACK.empty else 0,
        "metric": "Separation Burst Index (SBI)",
        "source": "ThompsonJamesBliss/nfl-big-data-bowl-regional-event-data",
    }


class InsightRequest(BaseModel):
    game_id: int
    play_id: int
    target_id: Optional[int] = None


@app.post("/api/insight")
def insight(body: InsightRequest) -> dict:
    data = get_sbi(body.game_id, body.play_id, body.target_id)
    sbi = data["sbi"]
    if "error" in sbi:
        return {"insight": sbi["error"], "source": "fallback"}

    text = (
        f"{sbi['target_name']} SBI={sbi['sbi']}. "
        f"Sep snap {sbi['sep_at_snap']} → 1.5s {sbi['sep_at_1_5s']} "
        f"(Δ {sbi['delta_separation']:+}). "
        f"Vel vs {sbi['defender_at_burst']}: {sbi['speed_advantage']:+}. "
    )
    if sbi["sbi"] >= 5:
        text += "Dominio de la ruta."
    elif sbi["sbi"] >= 2:
        text += "Separación útil."
    elif sbi["sbi"] >= 0:
        text += "Espacio marginal."
    else:
        text += "Ruta cubierta."

    try:
        import boto3
        region = os.environ.get("AWS_REGION", "us-east-1")
        model_id = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
        client = boto3.client("bedrock-runtime", region_name=region)
        prompt = f"Analista scouting NFL, 80 palabras para coach/comentarista:\n{text}"
        resp = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 200, "temperature": 0.4},
        )
        return {"insight": resp["output"]["message"]["content"][0]["text"], "source": "bedrock", "sbi": sbi}
    except Exception:
        return {"insight": text, "source": "fallback", "sbi": sbi}
