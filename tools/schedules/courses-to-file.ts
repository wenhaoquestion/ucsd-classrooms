import {
  BaseMeeting,
  groupSections
} from './group-sections.ts'
import type { ScrapedResult } from './scrape.ts'
import type { Time } from './Time.ts'

export function coursesToFile (
  result: ScrapedResult,
  buildingsOnly = false,
  includeDateRange = false
): string {
  const parts: string[] = []
  const print = (content: string) => parts.push(content)
  const printTime = (time?: Time) => print(
    time === undefined
      ? 'TBA '
      : time.hour.toString().padStart(2, '0') +
        time.minute.toString().padStart(2, '0')
  )
  function printMeeting (meeting: BaseMeeting, days = true) {
    print((meeting.location?.building ?? 'TBA').padEnd(5, ' '))
    if (days) {
      print((meeting.time?.days.join('') ?? 'TBA').padEnd(5, ' '))
    }
    print(meeting.type)
    // Normalize Mandeville basement room numbers.
    print((meeting.location?.room.replace(/^B-/, 'B') ?? 'TBA').padEnd(5, ' '))
    printTime(meeting.time?.start)
    printTime(meeting.time?.end)
  }
  function inPerson (meeting: BaseMeeting) {
    return meeting.time !== null && meeting.location !== null &&
      meeting.location.building !== 'RCLAS'
  }
  print(`V4${result.scrapeTime}\n`)
  for (const course of Object.values(groupSections(result))) {
    if (
      buildingsOnly &&
      course.groups.every(group =>
        [...group.sections, ...group.meetings, ...group.exams].every(
          meeting => !inPerson(meeting)
        )
      )
    ) {
      continue
    }
    const [subject, number] = course.code.split(' ')
    print(subject.padEnd(4, ' '))
    print(number.padEnd(5, ' '))
    if (!buildingsOnly) {
      print(course.title)
      if (course.catalog) {
        print('\t')
        print(course.catalog)
      }
    }
    print('\n')
    for (const group of course.groups) {
      if (
        buildingsOnly &&
        [...group.sections, ...group.meetings, ...group.exams].every(
          meeting => !inPerson(meeting)
        )
      ) {
        continue
      }
      const meetings = buildingsOnly
        ? group.meetings.filter(inPerson)
        : group.meetings
      const exams = buildingsOnly ? group.exams.filter(inPerson) : group.exams
      print(
        meetings.length > 0
          ? exams.length > 0
            ? ':'
            : '.'
          : exams.length > 0
            ? "'"
            : ' '
      )
      print(group.code)
      if (includeDateRange) {
        if (!group.dateRange) {
          throw new TypeError(
            `Summer session ${course.code} ${group.code} does not have date range.`
          )
        }
        print(group.dateRange.start.toString().replaceAll('-', ''))
        print(group.dateRange.end.toString().replaceAll('-', ''))
      }
      if (!buildingsOnly) {
        print(
          [
            group.sectionTitle?.replace(/\s+/, ' ') ?? '',
            ...group.instructors.map(({ first, last }) => `${first},${last}`)
          ].join('\t')
        )
      }
      print('\n')
      for (const meeting of group.sections) {
        if (buildingsOnly && !inPerson(meeting)) {
          continue
        }
        print(
          meeting.capacity === Infinity
            ? '9999'
            : meeting.capacity.toString().padStart(4, '0')
        )
        printMeeting(meeting)
        print(meeting.code)
      }
      print('\n')
      if (meetings.length > 0) {
        for (const meeting of meetings) {
          if (buildingsOnly && !inPerson(meeting)) {
            continue
          }
          printMeeting(meeting)
          print(meeting.code)
        }
        print('\n')
      }
      if (exams.length > 0) {
        for (const meeting of exams) {
          if (buildingsOnly && !inPerson(meeting)) {
            continue
          }
          print(meeting.date.toString().replaceAll('-', ''))
          printMeeting(meeting, false)
        }
        print('\n')
      }
    }
  }
  return parts.join('')
}
