# Glowstep

A big-screen dance-along for stages and mini festivals. Upload songs in **/admin**. Each one is analysed for its beats and gets an auto-made routine, which plays on **/screen**, where Zip the dancer leads the crowd.

## Pages

| Page | What it's for |
|---|---|
| `/screen` | The stage display. Open it on the computer connected to the big screen, click **Turn on sound** once (browsers need one click before they play audio), and it waits for the admin. |
| `/admin` | Upload MP3s, check and edit each routine, then load, play, pause and stop songs on the screen. There are also live "shout" buttons (FREEZE!, Make some noise!, or your own text). Works from a laptop or phone. |

## How the routine is made

All of this happens in the admin's browser when a song is uploaded (`public/analyze.js`):

1. The track is split into bass, treble and full-range bands, and drum hits are measured about 86 times a second.
2. Tempo is found from how the hits repeat, favouring danceable tempos. Very fast songs are halved and very slow songs doubled, so moves stay between 80 and 160 BPM.
3. Every beat is placed individually (dynamic-programming beat tracking), so songs that drift in tempo still line up.
4. Bar lines are placed where the kick drum is strongest, and each two-bar phrase is rated Chill, Groove or Party by loudness.
5. Moves are chosen from Zip's move library to match the energy, and each section repeats its pattern so the crowd can learn it. A **Freeze!** lands just before the music lifts, with a 3-2-1 countdown at the start and a big finish at the end.

In the editor you can change any bar's move or shout-out, shift where bars start, nudge the timing in 20 ms steps, or make a fresh routine.

## Running locally

```bash
npm install
ADMIN_PASSWORD=choose-one npm start
# admin:  http://localhost:3000/admin
# screen: http://localhost:3000/screen
```

## Deploying on Railway

1. Create a service from this GitHub repo. Railway detects Node and runs `npm start`.
2. **Add a volume** mounted at `/data`, and set the variable `DATA_DIR=/data`. Without a volume, uploaded songs are lost on every redeploy.
3. Set `ADMIN_PASSWORD` to lock `/admin`. If it's not set, the admin is open to anyone with the link.
4. Generate a domain. The screen is `https://<your-domain>/screen` and the admin is `https://<your-domain>/admin`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Set by Railway automatically. |
| `DATA_DIR` | `./data` | Where songs and routines are stored. |
| `ADMIN_PASSWORD` | *(none)* | Password for `/admin`. |

## Notes

- Playing commercial music at a public event usually needs a licence (in the UK, from PPL PRS). Festivals normally already have one.
- Beat detection is most reliable on music with a steady drum beat. For songs without clear drums, check the preview in the admin and adjust.
