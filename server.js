const crypto = require('node:crypto');
const {promisify} = require('node:util');
const express = require('express');
const {MongoClient, ObjectId} = require('mongodb');
const ViteExpress = require('vite-express');

require('dotenv').config();
const app = express();
const scrypt = promisify(crypto.scrypt);
const SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;
let grades;
let users;
let sessions;

const httpError = (status, message) => Object.assign(new Error(message), {status});

const makeGrade = body => {
  const className = typeof body?.className === 'string' ? body.className.trim() : '';
  const grade = body?.grade;
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  const includeInAverage = body?.includeInAverage === undefined ? true : body.includeInAverage;
  if (!className || typeof grade !== 'number' || !Number.isFinite(grade) || grade < 0 || grade > 100) {
    throw httpError(400, 'A class name and numerical grade from 0 to 100 are required.');
  }
  if ((body?.notes !== undefined && typeof body.notes !== 'string') || body?.notes?.length > 500) {
    throw httpError(400, 'Notes must be no more than 500 characters.');
  }
  if (typeof includeInAverage !== 'boolean') throw httpError(400, 'Include in average must be true or false.');
  return {
    className,
    grade,
    letterGrade: grade >= 90 ? 'A' : grade >= 80 ? 'B' : grade >= 70 ? 'C' : 'NR',
    notes,
    includeInAverage
  };
};

const parseId = id => {
  if (!ObjectId.isValid(id)) throw httpError(400, 'Invalid grade id.');
  return ObjectId.createFromHexString(id);
};

const parseCredentials = body => {
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw httpError(400, 'Username must be 3–32 letters, numbers, underscores, or hyphens.');
  }
  return {username, password};
};

const hashPassword = async password => {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${(await scrypt(password, salt, 64)).toString('hex')}`;
};

const passwordMatches = async (password, stored) => {
  const [saltHex, hashHex] = typeof stored === 'string' ? stored.split(':') : [];
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const sessionTokenFrom = request => request.headers.cookie?.split(';')
    .map(cookie => cookie.trim().split('='))
    .find(([name]) => name === 'session')?.[1];

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

const requireUser = async (request, response, next) => {
  const token = sessionTokenFrom(request);
  const session = token && await sessions.findOne({tokenHash: tokenHash(token), expiresAt: {$gt: new Date()}});
  if (!session) return response.status(401).json({error: 'Please log in.'});
  request.user = session;
  next();
};

const listGrades = async userId => (await grades.find({userId}).sort({_id: 1}).toArray())
    .map(({_id, userId: omitted, ...grade}) => ({
      notes: '',
      includeInAverage: true,
      ...grade,
      id: _id.toString()
    }));

app.set('trust proxy', 1);
app.use(express.json({limit: '10kb'}));

app.post('/auth/login', async (request, response) => {
  const {username, password} = parseCredentials(request.body);
  let user = await users.findOne({username});
  let created = false;

  if (!user) {
    try {
      const result = await users.insertOne({username, passwordHash: await hashPassword(password)});
      user = {_id: result.insertedId, username};
      created = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await users.findOne({username});
    }
  }
  if (!created && !await passwordMatches(password, user.passwordHash)) {
    throw httpError(401, 'Username or password is incorrect.');
  }

  const token = crypto.randomBytes(32).toString('hex');
  await sessions.insertOne({
    tokenHash: tokenHash(token),
    userId: user._id,
    username,
    expiresAt: new Date(Date.now() + SESSION_AGE_SECONDS * 1000)
  });
  response.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.secure,
    maxAge: SESSION_AGE_SECONDS * 1000
  }).json({username, created});
});

app.get('/auth/me', requireUser, (request, response) => response.json({username: request.user.username}));

app.post('/auth/logout', requireUser, async (request, response) => {
  await sessions.deleteOne({tokenHash: tokenHash(sessionTokenFrom(request))});
  response.clearCookie('session', {httpOnly: true, sameSite: 'lax', secure: request.secure}).status(204).end();
});

app.get('/grades', requireUser, async (request, response) => response.json(await listGrades(request.user.userId)));

app.post('/grades', requireUser, async (request, response) => {
  await grades.insertOne({...makeGrade(request.body), userId: request.user.userId});
  response.json(await listGrades(request.user.userId));
});

app.put('/grades/:id', requireUser, async (request, response) => {
  const result = await grades.updateOne(
      {_id: parseId(request.params.id), userId: request.user.userId},
      {$set: makeGrade(request.body)}
  );
  if (!result.matchedCount) throw httpError(404, 'Grade not found.');
  response.json(await listGrades(request.user.userId));
});

app.delete('/grades/:id', requireUser, async (request, response) => {
  const result = await grades.deleteOne({_id: parseId(request.params.id), userId: request.user.userId});
  if (!result.deletedCount) throw httpError(404, 'Grade not found.');
  response.json(await listGrades(request.user.userId));
});

app.use((error, request, response, next) => {
  const status = error.status || 500;
  if (status === 500) console.error(error);
  response.status(status).json({error: status === 500 ? 'Database request failed.' : error.message});
});

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const database = client.db('gradeCalculator');
  grades = database.collection('grades');
  users = database.collection('users');
  sessions = database.collection('sessions');
  await Promise.all([
    users.createIndex({username: 1}, {unique: true}),
    sessions.createIndex({expiresAt: 1}, {expireAfterSeconds: 0})
  ]);
  ViteExpress.listen(app, process.env.PORT || 3000);
};

main().catch(error => {
  console.error(`Server failed to start: ${error.message}`);
  process.exitCode = 1;
});
