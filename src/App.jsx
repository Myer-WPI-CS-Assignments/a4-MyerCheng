import React, {useEffect, useRef, useState} from 'react';
import averageFor from './average.mjs';

const emptyGrade = () => ({className: '', grade: '', notes: '', includeInAverage: true});

const requestJson = async (url, options) => {
  const response = await fetch(url, options);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error || 'Request failed.'), {status: response.status});
  return body;
};

const LoginForm = ({busy, status, onLogin}) => {
  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await onLogin({username: data.get('username'), password: data.get('password')})) form.reset();
  };

  return (
    <article aria-labelledby="login-heading">
      <h2 id="login-heading">Log in</h2>
      <p>Enter an existing account, or choose a new username to create one automatically.</p>
      <form onSubmit={submit}>
        <label htmlFor="username">Username</label>
        <input type="text" id="username" name="username" minLength="3" maxLength="32"
               pattern="[A-Za-z0-9_-]+" autoComplete="username" autoFocus required disabled={busy} />
        <label htmlFor="password">Password</label>
        <input type="password" id="password" name="password" minLength="8" maxLength="128"
               autoComplete="current-password" required disabled={busy} />
        <button type="submit" disabled={busy}>Log in or create account</button>
      </form>
      <p role="status">{status}</p>
    </article>
  );
};

const GradeForm = ({busy, draft, editing, inputRef, onChange, onSubmit, onCancel}) => (
  <>
    <h2>{editing ? 'Edit a class' : 'Add a class'}</h2>
    <form onSubmit={onSubmit}>
      <label htmlFor="class-name">Class name</label>
      <input ref={inputRef} type="text" id="class-name" value={draft.className}
             onChange={event => onChange({...draft, className: event.target.value})} required disabled={busy} />
      <label htmlFor="grade">Numerical grade (0–100)</label>
      <input type="number" id="grade" min="0" max="100" step="any" value={draft.grade}
             onChange={event => onChange({...draft, grade: event.target.value})} required disabled={busy} />
      <label htmlFor="notes">Notes (optional)</label>
      <textarea id="notes" maxLength="500" rows="3" value={draft.notes}
                onChange={event => onChange({...draft, notes: event.target.value})} disabled={busy} />
      <input type="checkbox" id="include-in-average" checked={draft.includeInAverage}
             onChange={event => onChange({...draft, includeInAverage: event.target.checked})} disabled={busy} />
      <label htmlFor="include-in-average">Include in average</label>
      <button type="submit" id="submit-button" disabled={busy}>{editing ? 'Save' : 'Add class'}</button>
      {editing && <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
    </form>
  </>
);

const GradeTable = ({busy, grades, onEdit, onDelete}) => (
  <>
    {grades.length === 0 && <p>No classes yet. Add a class above.</p>}
    <table>
      <caption>All saved class grades for this account</caption>
      <thead>
        <tr>
          <th>Class</th>
          <th>Numerical Grade</th>
          <th>Letter Grade</th>
          <th>Notes</th>
          <th>Included in Average</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {grades.map(row => (
          <tr key={row.id}>
            <td>{row.className}</td>
            <td>{row.grade}</td>
            <td>{row.letterGrade}</td>
            <td className="notes">{row.notes || '—'}</td>
            <td>{row.includeInAverage ? 'Yes' : 'No'}</td>
            <td>
              <button type="button" aria-label={`Edit ${row.className}`} onClick={() => onEdit(row)} disabled={busy}>Edit</button>{' '}
              <button type="button" aria-label={`Delete ${row.className}`} onClick={() => onDelete(row.id)} disabled={busy}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
);

const App = () => {
  const [user, setUser] = useState(null);
  const [grades, setGrades] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyGrade);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loginStatus, setLoginStatus] = useState('');
  const classNameInput = useRef(null);

  const resetForm = () => {
    setEditingId(null);
    setDraft(emptyGrade());
  };

  const showLoggedOut = message => {
    setBusy(false);
    setUser(null);
    setGrades([]);
    resetForm();
    setLoginStatus(message);
  };

  const requestGrades = async (url, options, message) => {
    setBusy(true);
    setStatus('Loading classes…');
    try {
      setGrades(await requestJson(url, options));
      setStatus(message);
      return true;
    } catch (error) {
      if (error.status === 401) showLoggedOut('Your session ended. Please log in again.');
      else setStatus('Could not update the display. ' + error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    requestJson('/auth/me').then(async result => {
      setUser(result.username);
      await requestGrades('/grades', {method: 'GET'}, 'Classes loaded.');
    }).catch(error => {
      showLoggedOut(error.status === 401 ? '' : 'Could not connect to the server.');
    });
  }, []);

  const login = async credentials => {
    setBusy(true);
    setLoginStatus('Logging in…');
    try {
      const result = await requestJson('/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(credentials)
      });
      setUser(result.username);
      await requestGrades('/grades', {method: 'GET'}, result.created ? 'Account created. Add your first class.' : 'Classes loaded.');
      return true;
    } catch (error) {
      setLoginStatus(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await requestJson('/auth/logout', {method: 'POST'});
      showLoggedOut('');
    } catch (error) {
      if (error.status === 401) showLoggedOut('Your session ended. Please log in again.');
      else setStatus(error.message);
    }
  };

  const saveGrade = async event => {
    event.preventDefault();
    const saved = await requestGrades(editingId === null ? '/grades' : '/grades/' + editingId, {
      method: editingId === null ? 'POST' : 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...draft, grade: Number(draft.grade)})
    }, editingId === null ? 'Class added.' : 'Class updated.');
    if (saved) {
      resetForm();
      classNameInput.current.focus();
    }
  };

  const editGrade = row => {
    setEditingId(row.id);
    setDraft({
      className: row.className,
      grade: String(row.grade),
      notes: row.notes,
      includeInAverage: row.includeInAverage
    });
    classNameInput.current.focus();
  };

  const deleteGrade = async id => {
    const saved = await requestGrades('/grades/' + id, {method: 'DELETE'}, 'Class deleted.');
    if (saved && editingId === id) resetForm();
    if (saved) classNameInput.current.focus();
  };

  const cancelEdit = () => {
    resetForm();
    classNameInput.current.focus();
  };

  const average = averageFor(grades);

  return (
    <>
      <header><h1>Grade Calculator</h1></header>
      <main>
        {user === null ? <LoginForm busy={busy} status={loginStatus} onLogin={login} /> : (
          <article>
            <p>Logged in as <strong>{user}</strong>.</p>
            <button type="button" onClick={logout} disabled={busy}>Log out</button>
            <p>Enter one class and its numerical grade at a time. Edit or delete classes below.</p>
            <p>Grade scale: A: 90–100, B: 80–below 90, C: 70–below 80, NR: below 70.</p>

            <GradeForm busy={busy} draft={draft} editing={editingId !== null} inputRef={classNameInput}
                       onChange={setDraft} onSubmit={saveGrade} onCancel={cancelEdit} />
            <p role="status">{status}</p>

            <h2>Classes</h2>
            <p><label htmlFor="average-grade">Average grade:</label>{' '}<output id="average-grade">{average}</output></p>
            <GradeTable busy={busy} grades={grades} onEdit={editGrade} onDelete={deleteGrade} />
            <p>Grades are saved privately between server restarts.</p>
          </article>
        )}
      </main>
    </>
  );
};

export default App;
