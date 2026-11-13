type InfoPanelProps = {
  className?: string;
};
export function InfoPanel({ className = "" }: InfoPanelProps) {
  return (
    <div className={`info-panel ${className}`}>
      <h1 className="title">UCSD Classroom Schedules</h1>
      <p className="instructions">
        Select a building to view its rooms.{" "}
        <a
          href="https://github.com/wenhaoquestion/ucsd-classrooms/blob/main/docs/schedules.md"
          className="link"
        >
          Schedule data
        </a>
      </p>
    </div>
  );
}
