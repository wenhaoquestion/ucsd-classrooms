# Classroom schedules

The site serves `schedules/classrooms-<TERM>.txt` for classroom views and the `-full.txt` version for course and instructor search. GitHub Pages includes both files from this repository's [schedule-data branch](https://github.com/wenhaoquestion/ucsd-classrooms/tree/schedule-data). The timestamp in the files records when the source data was captured.

## Refresh a term

1. Open [Actions → Refresh UCSD schedules](https://github.com/wenhaoquestion/ucsd-classrooms/actions/workflows/scrape-schedules.yml) and select **Run workflow** on `main`.
2. Enter a term code such as `FA26`, `SP26`, or `S126`.
3. Choose **archive** to import both files already published by [SheepTester](https://sheeptester.github.io/uxdy/data/). Choose **legacy** to generate both files directly from the [public UCSD Schedule of Classes](https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm) for a term it still serves.

The workflow validates the pair with the website's parser, commits it to `schedule-data`, and deploys the site. If the source returns an error or the files fail validation, the previous published snapshot stays available. The [Triton Student System](https://students.ucsd.edu/my-tritonlink/tools/index.html) serves Fall 2026 and later. Direct refreshes for those terms require an authorized data source. The archive option depends on the term having a published snapshot.

## Local development

With Deno 1.46.3, run the following from the repository root to generate a legacy schedule.

```sh
cd tools/schedules
deno run --check --allow-net=act.ucsd.edu --allow-write=output refresh.ts SP26
```

The files are written to `tools/schedules/output/`. For `npm run dev`, copy the files you want to view into `static/schedules/`. You can also copy them from the `schedule-data` branch.

The imported snapshots and legacy scraper originate in [SheepTester/uxdy](https://github.com/SheepTester/uxdy). The scraper and formatter are adapted from that repository's [October 2026 revision](https://github.com/SheepTester/uxdy/tree/ec68798229bf32e190eaf2b4d40ad693dd4a2019). Its MIT license is included in [tools/schedules/LICENSE](../tools/schedules/LICENSE).
