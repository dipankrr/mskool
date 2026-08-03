import express from 'express';
import attendanceRouter     from './routes/attendance.routes';
import marksRouter          from './routes/marks.routes';
import feeRouter            from './routes/fee.routes';
import roleRouter           from './routes/role.routes';
import roleAssignmentRouter from './routes/roleAssignment.routes';
import catalogRouter        from './routes/catalog.routes';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Domain routes
app.use(attendanceRouter);
app.use(marksRouter);
app.use(feeRouter);

// Auth management routes
app.use(roleRouter);
app.use(roleAssignmentRouter);

// Catalog (unauthenticated safe: public schema, no data)
app.use(catalogRouter);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Listening on :${PORT}`));

export default app;
