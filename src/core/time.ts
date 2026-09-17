// Whether two moments fall on the same local day. Home, the bar and the list
// of folders all ask it, and a day that ended at a different hour in one of
// them would have them disagree about what "today" is.
export const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();
