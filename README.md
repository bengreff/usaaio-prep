# USAAIO Prep

A free, unofficial online course for the USA AI Olympiad (USAAIO) Round 1 and Round 2: 168 short
lessons, 858 Part 1 style questions with worked solutions, 114 coding problems with
graders, syntax cards, unit quizzes and timed mock exams. It runs in the browser: no account, no server, no tracking.

**Live site: https://bengreff.github.io/usaaio-prep/**

Made with Claude. Not affiliated with or endorsed by USAAIO.

## How to use it

- Open the site and take the **placement quiz** (20 questions) to see which units you can skip, or
  start with lesson 1.
- The **Today** page plans each study session from the minutes you have: reviews that are due, the next lessons, a
  coding problem. Settings (the gear) set your exam date and weekly hours.
- Python (NumPy, pandas, scikit-learn, Matplotlib) runs in the browser with [Pyodide](https://pyodide.org). PyTorch
  does not: PyTorch problems open in Google Colab with a grader cell, and every other problem has a Colab notebook too,
  for real timing.
- Progress is saved in your browser only. Export it now and then from the About page (Save or restore your progress).

## Run it on your own computer

This repository is the complete site: static files, no build step needed to use it.

```
git clone https://github.com/bengreff/usaaio-prep.git
cd usaaio-prep
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open http://127.0.0.1:8000/. Any static file server works; opening index.html straight from the disk does not,
because browsers block the data files on `file://` pages. Progress you make there stays in that browser, separate
from the live site (export and import move it).

## Report a mistake

Every lesson, question, card and problem has a "Report a mistake" link. It opens a prefilled issue here
(https://github.com/bengreff/usaaio-prep/issues/new) with the item's id and page address; describe what is wrong and submit it. Nothing is sent
until you submit.

## What is in this repository

- `index.html`: the landing page. `app.html`: the course (a single-page app).
- `static/`: the app's code and styles, and the bundled KaTeX, marked and CodeMirror.
- `data/`: the course content as JSON (lessons, questions, cards, problems). Answers and graders are lightly
  scrambled so you do not read them by accident; that is not security.
- `notebooks/`: one Colab notebook per coding problem, with its grader.
- `py/`: the Python test harness that the browser and the notebooks run.
- `sw.js`: the service worker that makes the course work offline after a first visit.

The files are generated; changes made here by hand are overwritten by the next build.

## Licenses

- Code (the site's JavaScript, CSS, HTML and Python): MIT, see [LICENSE](LICENSE).
- Course content (lessons, questions, cards, coding problems, notebooks' statements): Creative Commons
  Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0), see [LICENSE-CONTENT](LICENSE-CONTENT).
- Bundled libraries keep their own licenses: see [LICENSES.md](LICENSES.md).

USAAIO and IOAI are named only to describe what the course prepares for. This project is not affiliated with or
endorsed by either.
