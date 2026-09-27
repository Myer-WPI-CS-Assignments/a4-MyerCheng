const averageFor = grades => {
  const included = grades.filter(grade => grade.includeInAverage);
  return included.length
      ? (included.reduce((sum, grade) => sum + grade.grade, 0) / included.length).toFixed(2)
      : '—';
};

export default averageFor;
