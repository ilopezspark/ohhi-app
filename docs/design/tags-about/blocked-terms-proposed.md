# Blocked terms: proposed list

Written 29 September 2026 for migration 0018 (`private.blocked_terms`,
`private.text_is_clean`). Slurs and profanity are written **masked** (first
and last letter, `*` in between) with their exact **base64** encoding, so this
file and the repo hold none of them in plain text and any tool can read it.
Decode one with `select convert_from(decode('<b64>', 'base64'), 'UTF8');` or
`node -e "console.log(Buffer.from('<b64>','base64').toString())"`. Threat,
solicitation and substance phrases are ordinary words and are written plainly.

The filter applies to every free-text profile field: `status_line`,
`place_line`, usual places, prompt answers, `job_title` and tag suggestions
(owner ruling 2 in `reconcile.md`). A refused value fails with SQLSTATE
`22023` and the message `that text can't be used`; nothing is stored.

## Status

| Group | Status |
| --- | --- |
| A. Slurs, unambiguous (core) | **Seeded and active** in migration 0018 |
| B. Contact info and handles (core patterns) | **Seeded and active** in migration 0018 |
| C. Slurs with an innocent reading | Pending owner approval |
| D. Sexual solicitation | Pending owner approval |
| E. Threats and violence | Pending owner approval |
| F. Substances | Pending owner approval |
| G. Contact info, looser patterns | Pending owner approval |
| H. General profanity | Not proposed (listed so the owner can decide) |

Nothing in C-H is in the database. To approve an entry, insert it as the
service role, from its encoding so no plain slur is typed anywhere:

```sql
insert into private.blocked_terms (term, match_kind, category, note)
values (convert_from(decode('<b64>', 'base64'), 'UTF8'), 'word', 'slur', 'approved <date>');
```

Turning one off without losing it: `update private.blocked_terms set active =
false where term = convert_from(decode('<b64>', 'base64'), 'UTF8');`.

## How matching works (so the owner can judge false positives)

- `word` (the default): the whole word, after normalising the text:
  lowercase; accents folded (`ï` -> `i`); leetspeak read as letters (`0` o,
  `1` i or l, `3` e, `4` a, `5` s, `7` t, `@` a, `$` s, `!` i, `|` l); runs
  of single letters split by spaces or punctuation joined (`f.o.o`,
  `f o o` -> `foo`); a letter repeated 3+ times read down (`fooooo`); a
  trailing plural `s` dropped (`foos`). A multi-word term (`foo bar`) matches
  as a phrase. Because it is whole-word, a short term never matches inside a
  longer ordinary word: the 0018 test runner adds short profanity as test
  terms and checks that `class`, `assignment`, `grass`, `bass`, `cocktail`,
  `cockatoo`, `hancock`, `analysis`, `grape`, `therapist`, `scunthorpe`,
  `raccoon`, `essex`, `shiitake`, `night shift` all pass, and that
  `sniggering`, `Niger` and `Nigeria` pass the core list.
- `substring`: the term anywhere inside a word. This is how filters end up
  refusing "Scunthorpe"; use only for strings no English word contains.
  Nothing is seeded as `substring`.
- `pattern`: a regular expression on the lowercased raw text, for contact
  info.

Known limits (accepted, conservative by design): a term split inside a word
by a space where the parts are longer than one letter is not caught;
homoglyphs from other alphabets (Cyrillic `а`) are not folded; spelled-out
numbers ("eight four seven") are not caught.

## A. Slurs against protected groups, unambiguous (seeded, active)

No ordinary English reading, so whole-word matching cannot hit an innocent
word. Migration 0018 seeds exactly these twelve, from the same encodings.

| masked | base64 | kind |
| --- | --- | --- |
| n****r | `bmlnZ2Vy` | word |
| n***a | `bmlnZ2E=` | word |
| f****t | `ZmFnZ290` | word |
| k**e | `a2lrZQ==` | word |
| w*****k | `d2V0YmFjaw==` | word |
| g**k | `Z29vaw==` | word |
| r*****d | `cmFnaGVhZA==` | word |
| t*******d | `dG93ZWxoZWFk` | word |
| z********d | `emlwcGVyaGVhZA==` | word |
| s*****e | `c2hlbWFsZQ==` | word |
| p***h m****y | `cG9yY2ggbW9ua2V5` | word (phrase) |
| j****e b***y | `anVuZ2xlIGJ1bm55` | word (phrase) |

## B. Contact info and handles (seeded, active)

A profile is not a way around the hi. These are refused anywhere in
profile text.

| what | pattern (lowercased raw text) | notes |
| --- | --- | --- |
| 10-digit US phone number | `(^\|[^0-9])(\+?1[ .-]?)?\(?[2-9][0-9]{2}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}([^0-9]\|$)` | catches `847 555 1234`, `(847) 555-1234`, `+1 847.555.1234`; not `class of 2027 2028`, `room 204` |
| email | `[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}` | |
| link | `(https?://\|www\.)[a-z0-9]` | |
| bare web address | `(^\|[^a-z0-9@._-])[a-z0-9-]+\.(com\|net\|org\|io\|me\|co\|app\|gg\|tv\|ly\|xyz\|link\|bio\|us\|info\|biz\|site\|online)([^a-z0-9]\|$)` | `mayamakes.co`, `sayohhi.com` |
| handle with its platform | `(^\|[^a-z])(ig\|insta\|instagram\|snap\|snapchat\|tiktok\|twitter\|discord\|telegram\|whatsapp\|kik\|venmo\|cashapp\|onlyfans) *[:@] *@?[a-z0-9_.]{2,}` | `insta: maya.k`, `snap @ maya22`; not `snap chat is fun` |
| @handle that looks like one | `(^\|[^a-z0-9_.])@([a-z][a-z0-9]*[_.][a-z0-9_.]*[a-z0-9]\|[a-z]+[0-9]{2,})` | `@maya_22`, `@maya.k`, `@maya22`; **not** `@gym`, `meet me @library`, `don't @ me` |

## C. Slurs with an innocent reading (pending owner approval)

Each has a common non-slur use that a campus profile could plausibly
contain. Recommendation per row.

| masked | base64 | innocent reading | recommendation |
| --- | --- | --- | --- |
| s**c | `c3BpYw==` | a cleaning phrase (usually spelled with a k) | approve (word) |
| c***k | `Y2hpbms=` | "a gap in the armor" idiom | reject, or approve only a phrase form |
| c**n | `Y29vbg==` | a cat breed (animals is a tag category) | reject as a word; approve phrases if wanted |
| t****y | `dHJhbm55` | car transmission slang (cars & motors is a tag category) | reject |
| d**e | `ZHlrZQ==` | reclaimed in-group use; a levee | owner's call |
| f*g | `ZmFn` | UK word for a cigarette | approve (word); its plural is covered by the plural rule |
| h**o | `aG9tbw==` | the genus in "homo sapiens" | reject as a word |
| r****d | `cmV0YXJk` | a verb ("to slow"); "flame retardant" is safe (whole word) | owner's call |
| r******d | `cmV0YXJkZWQ=` | same | owner's call |
| b****r | `YmVhbmVy` | baseball slang, rare | approve (word) |
| p**i | `cGFraQ==` | none common in US English | approve (word) |
| g***y | `Z3lwc3k=` | an ethnonym some Roma use; a lifestyle word | reject |
| j*p | `amFw` | an abbreviation in older usage | reject |
| w*p | `d29w` | rare, dated | approve (word) |
| d**o | `ZGFnbw==` | rare, dated | approve (word) |
| k***t | `a3JhdXQ=` | the food | approve (word) or owner's call |
| p****k | `cG9sYWNr` | rare, dated | approve (word) |
| c*****r | `Y3JhY2tlcg==` | a food | reject |
| r*****n | `cmVkc2tpbg==` | sports team history | approve (word) |

A compound of the core n-word with another word is already caught: the core
term matches as a whole word inside the phrase.

## D. Sexual solicitation (pending owner approval)

The concern is a profile used to sell or ask for sex, not ordinary talk
about dating. Phrases only, so single words like "sex" (as in "sex ed") do
not trip.

| term | kind |
| --- | --- |
| send nudes | word (phrase) |
| nudes for sale | word (phrase) |
| selling nudes | word (phrase) |
| sugar daddy | word (phrase) |
| sugar baby | word (phrase) |
| looking for hookups | word (phrase) |
| dtf | word |
| nsa fun | word (phrase) |
| fwb | word (the private card is where this belongs) |
| onlyfans | word (also covered as a handle when followed by `:`) |
| of link | word (phrase) |
| cashapp me | word (phrase) |
| pay for | reject: too broad ("pay for parking") |

## E. Threats and violence (pending owner approval)

Phrases only; single words like "kill" ("killing it at trivia") are too
common.

| term | base64 (for the two that are also crude) | kind |
| --- | --- | --- |
| kill you | | word (phrase) |
| kill yourself | | word (phrase) |
| kys | | word |
| shoot up the school | | word (phrase) |
| shoot up the campus | | word (phrase) |
| bomb the school | | word (phrase) |
| i will find you | | word (phrase) |
| r**e | `cmFwZQ==` | word (whole word only; `grape` is safe) |
| r****t | `cmFwaXN0` | word (`therapist` is safe) |

## F. Substances (pending owner approval)

The brief's rule: nothing about alcohol, smoking, weed or other substances in
the catalog; those live in `hard nos` on the private card. Applying the same
rule to free text is stricter than the brief asks, and some words have
common innocent uses in a job title or place line ("bar back", "wine
bar", "the pot roast place"). Recommendation: approve only the unambiguous
drug words below, and leave alcohol words alone unless the owner wants
free text held to the catalog rule too.

| term | kind | note |
| --- | --- | --- |
| weed | word | also "weed the garden"; owner's call |
| 420 friendly | word (phrase) | |
| plug | reject | "phone plug", outlets are a campus joke |
| edibles | word | |
| xanax, xans | word | |
| percs, percocet | word | |
| coke | reject | a soda |
| cocaine | word | |
| shrooms | word | |
| lsd | word | |
| acid | reject | chemistry class |
| molly | reject | a first name |
| vape, vaping | owner's call | |
| blunt, blunts | reject | "blunt" is a personality word |
| drunk, wasted, shots | reject | too common in ordinary text |

## G. Contact info, looser patterns (pending owner approval)

Each catches more evasion and more innocent text.

| what | pattern idea | false-positive risk |
| --- | --- | --- |
| 7-digit phone | `(^\|[^0-9])[0-9]{3}[-.][0-9]{4}([^0-9]\|$)` | room numbers like `204-1234` are rare; low |
| any @word | `(^\|[^a-z0-9])@[a-z]{3,}` | blocks `meet me @gym`; high |
| "my ig is", "snap me" | `(ig\|insta\|snap\|sc) +(is\|me) +@?[a-z0-9_.]{3,}` | `snap me a pic of the notes`; medium |
| spelled-out numbers | not proposed | very high |

## H. General profanity (not proposed)

The owner asked for a filter on slurs, solicitation, threats, contact info
and substances. Ordinary swearing is not in any of those groups and is not
proposed. If the owner wants it, add as `word` (never `substring`): the test
runner already proves that short swear words as whole-word terms do not hit
`class`, `shift`, `cocktail`, `scunthorpe` or `analysis`.

## Owner questions

1. Approve group C row by row, and D, E, F.
2. Should `first_name` also be filtered? It is free text shown on the grid
   but was not in ruling 2's list. Some real first names are also words, so
   if yes, it should use a separate, shorter list.
3. Should hard nos typed entries (private card, `identity` edge function)
   use the same list? They are private and never shown on the grid; not
   done in 0018.
