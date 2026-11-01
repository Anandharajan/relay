# HR simulation rerun after extractive fixes

Rerun on 1 November 2026 against the rebuilt app at `http://localhost:8788`, through the API, with the same `sample-handbook.txt` and the questions from `REPORT.md`. Fixes are uncommitted on `voice-desk` at the time of this run. No AI model, transcription or cloning engine was connected.

This is an agent-run rehearsal. No HR professional took part, so it says nothing about demand, time savings or willingness to pay.

| Task | Result | Verdict |
| --- | --- | --- |
| Two-part annual-leave question | States 18 days, PeoplePortal, 5 working days' notice and manager approval | Pass (was partial) |
| First-day checklist | All four day-one steps in time order, each with its owner, no duplicates | Pass, with the defects below (was fail) |
| Relocation amount | Says the policy does not define it and invents nothing; no longer quotes "Do not invent" | Pass, with the defect below |
| Recording with no transcription | Refused before the run starts; the microphone and upload are disabled and the desk says why | Clearer, still blocked |
| Voice, cloning, download, phone | Not connected, so not tested | Not testable |

## Known defects still open

- **Reworded questions can return the wrong sentence.** "What is the relocation allowance for a new employee?" returned "The new employee completes the security training by the end of day one. [1]". Without a model, matching is by shared words. HR replies stop at review, so a person sees this, but it would mislead someone reading quickly.
- **Stray sentence in the relocation answer.** It begins "Attach the receipt and business purpose." because "receive" loosely matches "receipt".
- **Checklist scope and order.** A first-day request also lists "before day one" steps, and after the day-one steps.
- These results come from one short handbook. Passing them does not show the method works on other documents.

## Still needed before a real pilot

Connect an AI model and transcription, rerun these tasks including the reworded question, then test enrollment, cloned playback and download on a phone over HTTPS.
