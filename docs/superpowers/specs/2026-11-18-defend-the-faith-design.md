# "Defend the Faith" mode — design

Date: 2026-11-18 · Status: draft for review

## Purpose

The user is producing a 50-part series of ~45-second YouTube Shorts, each
answering one popular objection to the Christian faith (list of 50 in
`~/Documents/Apologetics/Arguments`; produced files in
`~/Documents/Apologetics/Shorts/`). Shorts #1–#13 exist today; the rest arrive
over time. This mode brings them into the app as **learning paths**: tracks of
related shorts that a user works through in order, with a chat beside the
player that discusses each short and, once the user has watched every short in
the track, the track as a whole. The chat answers **from what the shorts
actually say** (their recorded scripts and descriptions).

The name echoes 1 Peter 3:15 ("be ready always to give an answer", Greek
*apologia*), which is the tile's subtitle. Internal id: `apologetics`.

Success: from the mode picker a user picks "Did Jesus rise?", sees the four
shorts with progress ticks, watches #3, presses "Ask about this", and gets an
answer grounded in that short's content whose Scripture references link into
the explorer. After the fourth short a "Discuss the whole track" prompt appears
and the chat can draw the four arguments together. A reload or share link
restores the track and its progress. Adding short #14 or a new track later is a
data edit plus re-running an import script — no code change.

## Goals, non-goals, anti-goals

Goals
- Three launch tracks built from shorts #1–#13 (below).
- Tracks and shorts are data: new tracks, and new shorts added to existing
  tracks, need no code change.
- Per-short discussion after watching it; whole-track discussion once the
  track is complete.
- Chat grounded on the shorts' content; Scripture refs become explorer links.

Non-goals (YAGNI): self-hosting the MP4s; the other brainstormed ideas
(objection-to-short matching, skeptic sparring, quizzes, short-of-the-day,
character-mode tie-ins); editing tracks from the UI; analytics; cross-session
or cross-device progress sync.

Anti-goals (a failure even if it technically works)
- The chat inventing arguments, facts, statistics or quotes the shorts don't
  contain and presenting them as the series' position.
- A track that shows a short that isn't uploaded yet as playable.
- Progress that silently resets on reload.

## Launch tracks

| id | Title | Shorts |
|---|---|---|
| `bible-reliable` | Is the Bible reliable? | #1 Historical Reliability, #2 Manuscript Integrity, #7 Archaeological Grounding, #8 Biblical Harmonization |
| `jesus-rose` | Did Jesus rise? | #3 The Resurrection, #4 Psychological Transformation, #5 Historical Evidence, #6 Eyewitness Testimony |
| `morality` | Where does morality come from? | #9 Moral Relativism, #10 Divine Lawgiver, #11 Moral Ontology, #12 Human Worth, #13 Social Contracts |

Order within a track is the listed order. Later shorts join existing tracks
(e.g. #50 → `jesus-rose`; #14, #40 → `morality`) or form new ones (God &
science, suffering, hard OT passages, who is Jesus, faith & life — see the
brainstorm grouping).

## Approaches (decided)

1. **Where the videos play** — *chosen: YouTube embed.* Alternative was
   self-hosting the MP4s (~55 MB each, ~2.75 GB for 50; cleaner player, but
   bandwidth/storage on the user's server and not committable to git). The
   user uploads to YouTube anyway, so only the video id is stored. Cost:
   YouTube branding and end-of-video suggestions (mitigated with `rel=0`,
   which limits suggestions to the same channel).
2. **How a track is presented** — *chosen: a playlist panel in the artifact
   pane beside the chat* (like Walk the Tabernacle). Alternative was posting
   shorts as cards inline in the chat: simpler, but no overview of the track
   and progress is hard to see.
3. **Grounding** — the whole track's content goes into every turn, as
   Chat with a Character does with a profile. A track is ≤ ~5 shorts × ~400
   words (script + description), so no retrieval is needed.

## Data

### Source files (outside the repo, owned by the user)

`~/Documents/Apologetics/Shorts/` per short `NN <Subject>`:
- `NN <Subject> - script.txt` — the narration **as recorded** (story form,
  e.g. the professor and the student). This, not the table in `Arguments`, is
  the content basis.
- `NN <Subject> - description.txt` — `TITLE:` line, `DESCRIPTION:` body
  ending with a `📚 Further reading:` line (items separated by ` · `, a mix of
  Scripture refs such as `1 Corinthians 15:3–7` / `Acts 2` / `Acts 5 & 12` and
  non-Scripture sources such as books and documents), then hashtags.
- `NN <Subject> - thumbnail.jpg`, and sometimes the MP4 (not used).

### Track definition (in the repo, hand-edited)

`chatbot/data/apologetics_tracks.yaml` — the only file the user edits by hand
(YAML so it can carry comments; if the project prefers no YAML dependency, JSON
is acceptable — builder's call):

```yaml
tracks:
  - id: jesus-rose
    title: Did Jesus rise?
    blurb: One sentence shown on the track card.
    shorts: [3, 4, 5, 6]
shorts:            # YouTube id per short number; absent = not uploaded yet
  1: 3hl-YcJKQkk
  2: TIFHMjGjXA4
  3: a4ASuGSh-Ek
  4: o1-JjQA-TbQ
  5: TK0yn3cjhCY
  6: qeiqu1FdTEs
  7: k4lcPyvCWVo
  8: 7HygRgAhW6g
  9: QoH_J7BUFkc
  10: sMTCMBsxYY8
  11: Sx14sr3m_6M
  12: HLcfmGJ5EhQ
  13: GJtSSePCZt4
```

### Built manifest (in the repo, generated, committed)

`scripts/import_apologetics_shorts.py [--source ~/Documents/Apologetics/Shorts]`
reads the track definition and the source folder and writes
`chatbot/data/apologetics_shorts.json`:

```json
{
  "tracks": [{"id": "...", "title": "...", "blurb": "...", "shorts": [3,4,5,6]}],
  "shorts": {
    "3": {
      "number": 3, "subject": "The Resurrection",
      "title": "<the video's current title on YouTube, e.g. Historical Reliability Of the Bible>",
      "youtube_id": "..." | null,
      "summary": "<DESCRIPTION body: no Further-reading line, no hashtags, no subscribe boilerplate>",
      "fiction_note": "(The professor and the student are fictional characters.)" | null,
      "script": "<script.txt verbatim>",
      "further_reading": [
        {"text": "1 Corinthians 15:3–7", "refs": ["1CO 15:3-7"]},
        {"text": "Acts 5 & 12", "refs": ["ACT 5:1", "ACT 12:1"]},
        {"text": "Arrian, \"Anabasis of Alexander\"", "refs": []}
      ],
      "thumbnail": "/apologetics/thumbs/03.jpg"
    }
  }
}
```

The importer also copies each thumbnail, resized to ≤ 480 px wide JPEG, to
`frontend/public/apologetics/thumbs/NN.jpg` (≈30–60 KB each) for the playlist
list. Scripture items are parsed with the project's existing reference parser
into a list of USFM refs, each opening one `interlinear` artifact (*my call*):
a verse or range is kept as is; a whole chapter (`Acts 2`, `John 21`) opens at
verse 1; a combined item (`Acts 5 & 12`) becomes one ref per chapter, shown as
one chip per ref. An item with no resolvable refs (`refs: []`) shows as plain
text. The description's parenthetical fiction note ("(The magistrate is a
fictional character…)") is extracted into `fiction_note` and kept, because the
chat sees it. The importer fails loudly if a track names a short whose source
files are missing. Re-running it is idempotent.

Titles (*user's decision*): a short's display title is **its title on
YouTube**, not the `TITLE:` line of its description file (five of the 13
differ). The importer fetches it for every short with a YouTube id from
YouTube's public oEmbed endpoint
(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json`,
no API key), so re-running the importer after renaming a video on YouTube
picks the new title up. A failed fetch fails the import loudly (it never falls
back to the description title, so the two can't silently mix). The
description file's `TITLE:` line is ignored.

Track membership (*my call*): a short may appear in any number of tracks, or in
none. An uploaded short in no track is still in the manifest and in the chat's
catalogue (below), just not in any playlist. Watched progress is per session,
which is one track, so a short in two tracks is watched separately in each.

Shipping mirrors Walk the Tabernacle: `Dockerfile.chatbot` copies the JSON to
the image and an env var (`APOLOGETICS_SHORTS_PATH`) points the loader at it;
local runs read the repo path. The frontend gets the same data from a backend
endpoint (`GET /apologetics/tracks`) rather than a second copy.

Visibility rule: a short with `youtube_id: null` is listed in its track as
"Coming soon" (greyed, not playable, not counted toward completion). A track
with no uploaded shorts is hidden. Completion = every *uploaded* short in the
track watched; adding a new short to a completed track makes it incomplete
again, which is intended (there's something new to watch).

## User flow

1. **Mode picker tile** "🛡️ Defend the Faith" — subtitle "Be ready always to
   give an answer — 1 Peter 3:15". Opens an inline starter (like Chat with a
   Character) listing the tracks as cards: title, blurb, "n shorts".
2. **Picking a track** creates a session `mode: 'apologetics'`,
   `modeParams: { trackId, watched: [], currentShort }` and its primer turn
   (no LLM) posts a short intro plus an `apologetics_track` artifact, opened
   in the side panel on arrival (same `openOnShow` mechanism as tabernacle;
   skipped at phone width, where the chat shows an "Open the playlist" card).
   One session per track; starting the same track again makes a new session.
3. **The playlist panel** (`ApologeticsTrackArtifact`):

   ```
   ┌ Did Jesus rise? ────────────────────── 2 / 4 ┐
   │             ▶ [ YouTube player ]              │
   │  Did Jesus Really Die on the Cross?           │
   │  [Ask about this]  [Mark watched]             │
   │  Further reading: John 19:31–37 · …           │
   ├───────────────────────────────────────────────┤
   │ ✓ Nobody Dies for a Lie They Invented         │
   │ ✓ Evidence that Jesus Has Indeed Resurrected  │
   │ ▸ Did Jesus Really Die on the Cross?          │
   │ ○ Name One Witness To Jesus Resurrection      │
   └───────────────────────────────────────────────┘
   ```

   - Shorts are shown **by title** everywhere (playlist rows, the panel
     heading, the "Ask about this" message), the same titles the chat uses, so
     "the short titled …" always matches something the user can see. Short
     numbers are internal (ordering, ids) and not shown.

   - Player: `youtube-nocookie.com` embed via the YouTube IFrame Player API,
     `rel=0`, `playsinline=1`. Shorts are vertical; the player is 9:16 and
     height-capped so the list stays visible.
   - Watched: marked automatically on the player's ENDED state, or manually via
     "Mark watched" (fallback if the API script fails to load, or a user who
     watched it on YouTube). On ENDED the panel advances to the next unwatched
     short but does not autoplay it.
   - Any short can be selected and played in any order; order is a suggestion.
   - Further-reading chips (one per ref) open an `interlinear` artifact (like
     tabernacle panel refs); others are plain text.
4. **Per-short discussion.** "Ask about this" (enabled once that short is
   watched) posts a user message ("Tell me more about '<title>'") and the
   reply follows with LLM follow-up chips. The user can also type anything at
   any time — the chat is never locked.
5. **Track discussion.** When the last uploaded short is marked watched, the
   frontend posts an assistant-style prompt card in the chat: "You've finished
   *Did Jesus rise?* — want to talk through the whole track?" with a
   "Discuss the whole track" button and two or three fixed starter questions
   (e.g. "How do these arguments fit together?", "Which objection is hardest
   to answer?"). This is the only gated element; it appears once per session.

## Backend

New `chatbot/apologetics_mode.py`, modelled on `tabernacle_mode.py`:
- `load_manifest()` — cached JSON load, `{}` + logged error if missing.
- `primer(mode_params)` — intro text + `apologetics_track` artifact
  `{trackId}`; unknown track → honest error message, no artifact.
- `answer(message, history, mode_params)` — one LLM call via
  `call_ollama_with_context`, `research_data` = (a) every uploaded short in the
  track in full (number, title, script, summary, fiction note,
  further-reading list), with the `currentShort` marked as "the short the user
  is watching now" and the `watched` set listed; plus (b) a catalogue of every
  other uploaded short in the manifest, one line each (number, title, subject,
  first sentence of the summary, tracks it is in), so the chat can point to
  another short without guessing (*my call*; ~50 lines at full size). References run through
  `wiki_refs.resolve_scripture_refs`; follow-ups from `generate_llm_follow_ups`.
  Failure → fixed honest message, like tabernacle.
- `GET /apologetics/tracks` — tracks + shorts for the frontend (scripts may be
  omitted from this payload; the frontend doesn't show them).

Routing: `mode == "apologetics"` branches in both `post_chat` and
`_stream_chat_response` in `chatbot/api.py`; the empty-message primer goes
through `router.build_mode_primer`. Whole reply in one `final` event.

### Grounding rules (system prompt)

- The shorts provided are the basis. Explain, expand on and connect the
  arguments they make; quote or paraphrase them.
- Scripture the shorts cite, and plain KJV Scripture generally, may be quoted
  and cited as "Book chapter:verse".
- Do not introduce new historical facts, statistics, quotes, scholars or
  arguments the shorts don't contain. When a question goes beyond them, say
  plainly that this series doesn't cover it (yet), and if a short in the
  catalogue does, name it. Never name a short that isn't in the material.
- *User's decision:* refer to a short **by its title**, never by its number:
  "that's covered in the short titled 'Historical Reliability Of the Bible'",
  not "that's covered in #1". The title is the video's title on YouTube (the
  manifest's `title`). For a short in
  another track, also name the track ("…in the *Where does morality come
  from?* track"). The grounding material gives each short's title, so the
  model never has to invent one.
- The shorts are told as stories with fictional characters (the professor and
  the student, the magistrate, …). *User's decision:* the chat may refer to and
  briefly retell a short's story ("remember the student who checked the
  dates?") to connect an answer to what the user watched, but must treat its
  characters as fictional, never as historical people or sources, and must
  keep the story apart from the factual claims it illustrates. Real people
  named in the material (Arrian, Dr. King, Nietzsche, …) are cited only for
  what the material says about them.
- Don't reveal or discuss which short is unwatched in a way that spoils; it's
  fine to say "that's covered later in this track, in the short titled …".
- Tone: plain, warm, confident but not combative; short answers.

## Frontend wiring (by analogy with tabernacle)

- `SessionMode` gains `'apologetics'`; `ModeParams` gains `trackId`,
  `watched: number[]`, `currentShort`. Progress lives in the session, so
  reloads and share links restore it.
- Artifact type `apologetics_track` registered in `ArtifactPane` and the
  artifact store; chat shows it as a card ("Open the playlist").
- `ModePickerScreen` tile + inline track starter; `SessionsPane` icon.
- `ChatPane`: handlers for Ask, watched changes (`modeParams` update), and
  the one-time track-complete prompt.
- A future CSP must allow `www.youtube-nocookie.com`, `www.youtube.com`
  (iframe API script) and `i.ytimg.com`; nginx sets none today.

## Testing

- Importer: parses the 13 real description/script files (fixtures copied
  from them), strips boilerplate/hashtags, parses Further-reading into
  Scripture vs plain items, errors on a missing short.
- Manifest test: every track's shorts exist, ids unique, every
  ref in `refs` resolves in `Complete.db` (like `test_tabernacle_spots.py`).
- `apologetics_mode`: primer artifact; grounding includes every uploaded
  short of the track and marks the current one; unknown track handled.
- Frontend: playlist renders ticks/coming-soon; ENDED and "Mark watched"
  update `modeParams`; completion prompt appears exactly once; ref chip opens
  an interlinear artifact.
- Docker image ships the manifest (like `test_chatbot_image_ships_the_profiles`).

## Left to the builder

Exact component/file names beyond those above; YAML vs JSON for the track
definition; icon choice; copy of the intro and starter questions; how the
importer strips description boilerplate (the subscribe line and hashtags are
consistent across the 13 files); thumbnail resizing tool (Pillow is fine).

Tests use a fixture manifest, never the committed one's ids or titles, and
never call YouTube.

## Status at approval (2026-11-18)

All 13 shorts (#1–#13) are uploaded to the channel, so all three launch
tracks are complete with no "Coming soon" entries. Suggested (not required)
renames on YouTube before importing: #12 is titled just "Human Worth" (the
subject, not a real title), #7 reads "The Gospel Are True History…".
