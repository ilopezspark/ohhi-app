# Implement: expanded tags + a structured "about" section

Owner's brief, received 29 September 2026, kept verbatim below. Reconciliation
notes against the live schema are in `reconcile.md` in this folder once written.

## Context

OhHi — campus proximity app for verified students. React Native + Expo,
Supabase. Reconcile every field against the existing schema and the profile
taxonomy doc; do not invent table or column names. If a field below doesn't
exist yet, say so rather than guessing.

Two changes, in this order.

## 1. Tags become interests only

Today `tags` is a max-3 grab bag holding majors, places and interests mixed
together. Split it:

- **Tags = interests only.** Max raised from 3 to **10**, min 3 to publish.
- Everything identity- or program-shaped moves out of the tag table into
  structured fields (section 2).
- Tags stay a **closed catalog** with a suggest-a-tag queue. The catalog below
  replaces the current seed entirely.

### Schema

- `tags` gains `category` (enum, the 18 below) and `campus_type`
  (`all` | `commuter` | `residential`, default `all`).
- `profile_tags` cap changes 3 → 10. Enforce server-side, not just in the UI.
- Migration: existing tags that are majors map to `profiles.major`; existing
  place tags map to `profile_places`; the rest map onto the new catalog by
  exact string, and anything unmatched is dropped with a one-time notice to
  that user on next open.

### The picker

Rebuild as a full-screen picker, not the current inline wrap:

- Sticky selected tray at the top, ✕ chips, live counter.
- Search field that filters across all categories.
- Category sections, collapsed by default past the first three, with a count
  per section.
- CTA carries the counter: `continue · 7 of 10`.
- `suggest a tag` at the very bottom. It does NOT add to the profile — it
  writes to the moderation queue.

## 2. New profile section: about

A structured section, above `the basics`, on both the public profile and the
Me editor.

### Fields

| Field | Type | Notes |
| --- | --- | --- |
| `major` | closed enum, campus pack | already exists — move it here |
| `minor` | closed enum, campus pack, optional | same catalog as major |
| `stage` | closed enum | already exists |
| `graduating_term` | enum: spring / summer / fall / winter | optional |
| `graduating_year` | int, current year → +8 | optional; with term renders "spring 2028" |
| `graduating_unsure` | bool | renders "not sure yet"; mutually exclusive with term/year |
| `work_type` | closed enum, below | optional, drives "others who work in food service" |
| `job_title` | free text, 48 chars, moderated | optional, expression only |
| `work_hours` | closed enum, below | optional |

`work_type` options: food service · retail · warehouse · delivery · healthcare
aide · childcare · tutoring · landscaping · construction · trades apprentice ·
office or admin · customer service · security · campus job · internship ·
family business · freelance · military or reserves · rideshare · not working
right now · rather not say

`work_hours` options: part time · full time · nights · weekends · seasonal ·
on call

### Rendering

Public profile, `about` card, icon + value rows, hairline separated, in this
order — skip any row with no value, never render a placeholder:

1. major (+ minor as a sub-line if set)
2. stage + graduating term/year on one line: "second year · graduating
   spring 2028"
3. work_type + job_title: "food service · barista at a place downtown"
4. work_hours as a sub-line under work
5. what's next

## 3. The tag catalog

Seed exactly these. All lowercase. `campus_type` is `all` unless marked.

**sports** — basketball · soccer · football · baseball · softball · volleyball ·
hockey · tennis · pickleball · golf · track · cross country · swimming ·
wrestling · boxing · mma · martial arts · jiu jitsu · gymnastics · cheer ·
dance team · skateboarding · snowboarding · skiing · rock climbing ·
bouldering · bowling · disc golf · rugby · lacrosse · badminton ·
table tennis · intramurals · pickup games · fantasy leagues · watching more
than playing

**fitness** — gym · lifting · powerlifting · crossfit · running · half
marathons · 5ks · cycling · spin · yoga · pilates · hiit · calisthenics ·
swimming laps · meal prep · morning workouts · late night gym · rest days ·
walking everywhere · gym buddy needed

**music** — guitar · bass · piano · drums · violin · saxophone · singing ·
choir · a cappella · marching band · jazz band · orchestra · dj · producing ·
songwriting · vinyl · concerts · festivals · karaoke · hip hop · r&b · rock ·
punk · metal · indie · pop · country · jazz · classical · edm · reggaeton ·
corridos · afrobeats · k-pop · latin music · gospel · lo-fi · always has
headphones in

**film & tv** — horror movies · comedy specials · action movies · rom coms ·
documentaries · anime · manga · studio ghibli · a24 movies · marvel · dc ·
star wars · star trek · sitcoms · reality tv · true crime · k-dramas ·
telenovelas · bollywood · cartoons · movie theater over streaming ·
letterboxd · rewatches the same show

**games** — pc gaming · console gaming · playstation · xbox · switch ·
steam deck · mobile games · fps · rpgs · mmos · minecraft · fortnite ·
valorant · league · cod · fifa · madden · roblox · sims · animal crossing ·
indie games · retro games · speedruns · tabletop · d&d · magic the gathering ·
warhammer · board games · chess · poker · puzzles

**reading & writing** — fiction · nonfiction · fantasy · sci fi · mystery ·
thrillers · romance novels · poetry · memoirs · philosophy · history books ·
self help · comics · graphic novels · book club · audiobooks · writing ·
journaling · fanfic · goodreads · library regular

**making & art** — drawing · painting · digital art · graphic design ·
animation · sculpture · ceramics · pottery · printmaking · photography ·
film photography · videography · video editing · sewing · embroidery ·
crochet · knitting · thrift flipping · jewelry making · woodworking ·
3d printing · leatherwork · candle making · nail art · makeup · hair ·
tattoos · piercings

**food & drink** — cooking · baking · grilling · coffee · espresso ·
bubble tea · matcha · energy drinks · smoothies · tacos · sushi · ramen ·
pizza · bbq · hot pot · wings · breakfast food · brunch · street food ·
food trucks · trying new restaurants · hole in the wall spots ·
family recipes · vegetarian · vegan · halal · kosher · gluten free ·
baking for people · i will cook for you

**going out** — concerts · festivals · house parties · karaoke nights ·
trivia nights · bowling · arcades · mini golf · escape rooms · pool halls ·
car meets · thrifting · flea markets · museums · art shows ·
sporting events · road trips · day trips to the city · late night drives ·
late night food runs · first one there and last one out

**staying in** — movie nights · gaming nights · board game nights ·
cooking together · reading · napping · podcasts · youtube rabbit holes ·
organizing · plants · candles · cleaning to music ·
doing nothing productively · early nights

**outdoors** — hiking · camping · backpacking · fishing · hunting ·
kayaking · canoeing · paddleboarding · boating · the lake · the beach ·
national parks · forest preserves · stargazing · birdwatching · gardening ·
bonfires · want to travel more · traveling on a budget ·
first in my family with a passport

**animals** — dogs · cats · my dog · my cat · puppies · kittens · reptiles ·
snakes · birds · fish · horses · rabbits · farm animals ·
allergic but still obsessed · will pet your dog

**tech & building** — coding · web dev · app dev · game dev · cybersecurity ·
networking · ai · robotics · electronics · pc building · modding · linux ·
drones · home lab · fixing things · taking things apart · smart home

**cars & motors** — cars · car meets · working on my car · detailing · jdm ·
muscle cars · offroading · trucks · motorcycles · dirt bikes · atvs · racing ·
f1 · nascar · drifting · my car is my third place

**community & belief** — church · bible study · faith · volunteering ·
mutual aid · activism · student government · my club · my org · rotc ·
veteran · first gen · bilingual · interpreting for my family · mentoring ·
tutoring · food pantry · blood drives · community college pride ·
fraternity *(residential)* · sorority *(residential)*

**campus life** — library regular · night classes · 8ams · group projects ·
study groups · office hours · the commons · tutoring center · campus job ·
work study · clubs fair · intramural teams · transfer track · honors ·
phi theta kappa · i know where the good outlets are · free food radar ·
i live in the parking lot *(commuter)* · dorm life *(residential)* ·
stays on campus weekends *(residential)*

**the honest ones** — working full time · working two jobs · night shift ·
back after a break · parent · caregiver · commuting an hour · no car ·
catching the bus · broke but down · budgeting everything ·
first semester nerves · second attempt at this · online mostly ·
graduating late and fine with it · doing this for my family

**traits** — introvert · extrovert · ambivert · always early · always late ·
planner · spontaneous · competitive · chill · loud · quiet · sarcastic ·
dry humor · dad jokes · overthinker · optimist · realist · homebody ·
social battery runs out · texts back fast · bad at texting · direct ·
loyal · independent · family first · dog person · cat person · night owl ·
morning person

## Rules

- Nothing about alcohol, smoking, weed or other substances goes in this
  catalog. Those live in `hard nos` on the private card.
- No emoji in tag names. All lowercase. No tag names a real person's name,
  a brand the user works for, or a physical attribute.
- The 10-tag cap is enforced in the API, not only the picker.
- Tags render on the public profile in the order the user picked them; the
  tile shows the first 3.
- `job_title` goes through the same moderation path as status and prompts.

## Out of scope

Don't touch the grid, chat, onboarding flow, or the private card. Don't add
filtering or search by tag yet — that's a separate decision.
