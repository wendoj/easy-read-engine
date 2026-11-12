# P5 common-word list

P5 (plain words) passes a word if its lemma or its written form is in one of these files. `checks/p5_plain_words.py` loads them once.

| File | What it is | Source | Licence |
| --- | --- | --- | --- |
| `ngsl-1.2-lemmatized-for-research.csv` | New General Service List 1.2: 2,809 headwords of general English, each with its inflected forms on the same row | [NGSL Project](https://www.newgeneralservicelist.com/new-general-service-list), file `NGSL_12_lemmatized_for_research.csv`, downloaded 11 November 2026 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `ngsl-1.2-supplement-lemmatized.csv` | NGSL supplement: days of the week, months and number words, with their forms | Same page, file `SUP_lemmatized.csv` | CC BY-SA 4.0 |
| `extra.txt` | This project's short list of everyday words that UK letters use and the NGSL leaves out (for example "cheque", "postcode", "landlord") | This project | CC BY-SA 4.0, to match the list it extends |
| `names.txt` | Names that letters print and spaCy's small model doesn't tag as names (for example "Inspectorate", "GOV.UK"). Not part of the common-word list: P5 passes a token only when it is written exactly as listed, so the lower-case word is still checked (`NAMES_FILE` in `checks/config.py`) | This project | CC BY-SA 4.0 |

Attribution: New General Service List by Browne, C., Culligan, B., and Phillips, J., licensed under CC BY-SA 4.0. Browne, C., Culligan, B. (2013). The New General Service List. Retrieved from https://www.newgeneralservicelist.com.

The 2 NGSL files are unchanged copies of the published files, including their `##` comment lines. They are not covered by the project's MIT licence.

Why the NGSL: it is a published, corpus-based list (from 265 million words of the Cambridge English Corpus) made for second-language learners, one of this project's audiences. Its 2,809 words give about 92% coverage of general English text, and it is lemma-based, which matches how P5 compares words.

To add a word, put it in `extra.txt` with a reason in the pull request. Add a name to `names.txt` only if it is the name of a sender, service, place or website; legal terms written in Title Case ("Enforcement Agent") are not names. Words that are only common in official letters ("liability", "arrears", "representation") belong in an explanation in the output, not in this list.
