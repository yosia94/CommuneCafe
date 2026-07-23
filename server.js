require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const session = require('express-session');

const app = express();


// -------------------- MIDDLEWARE --------------------

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'commune-cafe-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8
  }
}));


// -------------------- POSTGRES CONNECTION --------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch(err => console.error("❌ PostgreSQL connection error:", err));


// -------------------- PUBLIC PAGES --------------------


// Landing page
app.get('/', (req, res) => {
  res.render('index');
});


// Registration form
app.get('/register', async (req, res) => {

  try {

    const result = await pool.query(
      `SELECT * FROM welcome_message LIMIT 1`
    );

    const welcome = result.rows[0];

    res.render('form', { welcome });

  } catch (err) {

    console.error("Register page error:", err);
    res.send("❌ Error loading registration form");

  }

});


// Handle registration
app.post('/register', async (req, res) => {

  const {
    name,
    email,
    whatsapp,
    source,
    counselling,
    instagram,
    eta
  } = req.body;


  const id = uuidv4();


  try {


    // Insert registration
    await pool.query(
      `
      INSERT INTO registrations
      (
        id,
        participants_name,
        participants_email,
        participants_wa,
        "source",
        counselling_session,
        participants_ig,
        time_arrival,
        created_date
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      [
        id,
        name,
        email,
        whatsapp,
        source,
        counselling,
        instagram,
        eta
      ]
    );



    // Get event settings
    const eventResult = await pool.query(
      `
      SELECT *
      FROM event_settings
      LIMIT 1
      `
    );
    const event = eventResult.rows[0];
    if (!event) {
      return res.send("❌ Event settings not found");
    }

    // Get email template
    const templateResult = await pool.query(
      `
      SELECT *
      FROM email_templates
      LIMIT 1
      `
    );

    const template = templateResult.rows[0];
    if (!template) {
      return res.send("❌ Email template not found");
    }
	// Format event date nicely
	const formattedDate = new Date(event.date).toLocaleDateString('id-ID', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
	const subject = template.confirmation_subject;
	const body = template.confirmation_body
	.replace('<%= name %>', name)
	.replace('<%= date %>', formattedDate)
	.replace('<%= place %>', event.place);
	await sendEmail(
	email,
	subject,
	body
	);
    res.render('thankyou', { name });
  } catch (err) {
    console.error("Registration error:", err);
    res.send("❌ Error saving registration");
  }
});

// -------------------- CRON REMINDER EMAIL --------------------

cron.schedule(
  '0 9 * * *',
  async () => {
    try {
      // Get event settings
      const eventResult = await pool.query(`
        SELECT *
        FROM event_settings
        LIMIT 1
      `);

      const event = eventResult.rows[0];
      if (!event) {
        console.log("❌ Event settings not found");
        return;
      }
      const eventDate = new Date(event.date);

      // Tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Is event tomorrow?
      if (
        eventDate.getFullYear() === tomorrow.getFullYear() &&
        eventDate.getMonth() === tomorrow.getMonth() &&
        eventDate.getDate() === tomorrow.getDate()
      ) {
        console.log("📅 Event is tomorrow. Sending reminder emails...");

        // Format date nicely
        const formattedDate = eventDate.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });

        // Get all registrants
        const registrationsResult = await pool.query(`
          SELECT participants_name, participants_email
          FROM registrations
        `);

        // Get reminder template
        const templateResult = await pool.query(`
          SELECT *
          FROM email_templates
          LIMIT 1
        `);

        const template = templateResult.rows[0];
        if (!template) {
          console.log("❌ Reminder template not found");
          return;
        }

        // Send reminder email
        for (const r of registrationsResult.rows) {
          const subject = template.reminder_subject;
          const body = template.reminder_body
            .replace('<%= name %>', r.participants_name)
            .replace('<%= date %>', formattedDate)
            .replace('<%= place %>', event.place);
          await sendEmail(
            r.participants_email,
            subject,
            body
          );
          console.log(`✅ Reminder sent to ${r.participants_email}`);
        }
        console.log("🎉 All reminder emails have been sent.");
      } else {
        console.log("📅 No reminder today.");
      }
    } catch (err) {
      console.error("❌ Cron error:", err);
    }
  },
  {
    timezone: 'Asia/Jakarta'
  }
);

// -------------------- EMAIL FUNCTION --------------------

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, text) {
  console.log("📨 Preparing email to:", to);
  try {
    const emailResult = await resend.emails.send({
      from: 'Commune Cafe <hello@communecafe.my.id>',
      to: [to],
      subject: subject,
      html: `
        <div>
          ${(text || '').replace(/\n/g, '<br>')}
        </div>
      `
    });
    if (emailResult.error) {
      console.log("❌ Resend error:", emailResult.error);
    } else {
      console.log(
        "📧 Email sent ID:",
        emailResult.data.id
      );
    }
  } catch (error) {
    console.log("❌ Email error:", error);
    throw error;
  }
}

// -------------------- ADMIN CMS --------------------

// Admin login page
app.get('/admin', (req, res) => {
  res.render('admin_login', { error: null });
});

// Admin login POST
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM admins WHERE username = $1 AND "password" = $2`,
      [username, password]
    );

    const admin = result.rows[0];

    if (!admin) {
      return res.render('admin_login', {
        error: "Invalid username or password"
      });
    }

    // Save login session
		req.session.admin = {
		id: admin.id,
		username: admin.username,
		role: admin.role
		};
		res.redirect('/admin/dashboard');

  } catch (err) {
    console.error("Admin login error:", err);
    res.send("❌ Error checking admin");
  }
});

function isAuthenticated(req, res, next) {

    if (req.session && req.session.admin) {
        next();
    } else {
        res.redirect('/admin/login');
    }

}

// Dashboard
app.get('/admin/dashboard', isAuthenticated, (req, res) => {
  res.render('admin_dashboard', {
    admin: req.session.admin
  });
});

// Event settings
app.get('/admin/event-settings', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM event_settings LIMIT 1`
    );

    res.render('event_settings', {
      event: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.send("❌ Error loading event settings");
  }
});

app.post('/admin/event-settings', isAuthenticated, async (req, res) => {
  const { date, place, start_time, end_time } = req.body;

  console.log("FORM DATA:");
  console.log({
    date,
    place,
    start_time,
    end_time
  });

  try {
const eventDate = new Date(date);
const formattedDate =
  `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
    await pool.query(`DELETE FROM event_settings`);
    await pool.query(
      `
      INSERT INTO event_settings
      (
        id,
        "date",
        place,
        start_time,
        end_time
      )
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        '1',
        eventDate,
        place,
        start_time,
        end_time
      ]
    );

    res.redirect('/admin/dashboard');

  } catch (err) {
    console.error("Event settings save error:", err);
    res.send("❌ Error saving event settings");
  }
});

// Welcome message
app.get('/admin/welcome-message', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM welcome_message LIMIT 1`
    );

    res.render('welcome_message', {
      welcome: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.send("❌ Error loading welcome message");
  }
});

app.post('/admin/welcome-message', isAuthenticated, async (req, res) => {
  const { message } = req.body;

  try {
    await pool.query(`DELETE FROM welcome_message`);

    await pool.query(
      `
      INSERT INTO welcome_message
      (id, message)
      VALUES ($1,$2)
      `,
      ['1', message]
    );

    res.redirect('/admin/dashboard');

  } catch (err) {
    console.error(err);
    res.send("❌ Error saving welcome message");
  }
});

// Email templates
app.get('/admin/email-templates', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM email_templates LIMIT 1`
    );

    res.render('email_templates', {
      template: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.send("❌ Error loading email templates");
  }
});

app.post('/admin/email-templates', isAuthenticated, async (req, res) => {
  const {
    confirmation_subject,
    confirmation_body,
    reminder_subject,
    reminder_body
  } = req.body;

  try {
    await pool.query(`DELETE FROM email_templates`);

    await pool.query(
      `
      INSERT INTO email_templates
      (
        id,
        confirmation_subject,
        confirmation_body,
        reminder_subject,
        reminder_body
      )
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        '1',
        confirmation_subject,
        confirmation_body,
        reminder_subject,
        reminder_body
      ]
    );

    res.redirect('/admin/dashboard');

  } catch (err) {
    console.error(err);
    res.send("❌ Error saving email template");
  }
});

// List Participants for Admin
app.get("/admin/participants", isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                participants_name,
                participants_email,
                participants_wa,
                participants_ig,
                source,
                counselling_session,
                time_arrival,
                created_date
            FROM registrations
            ORDER BY created_date DESC
        `);

        res.render("participants", {
            participants: result.rows,
            total: result.rowCount
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Export Participants to Excel
app.get("/admin/participants/export", isAuthenticated, async (req, res) => {
    try {

        const result = await pool.query(`
            SELECT
                participants_name AS "Name",
                participants_email AS "Email",
                participants_wa AS "WhatsApp",
                participants_ig AS "Instagram",
                source AS "Source",
                counselling_session AS "Counselling Session",
                time_arrival AS "Arrival Time",
                created_date AS "Registered Date"
            FROM registrations
            ORDER BY created_date DESC
        `);

        const ExcelJS = require("exceljs");
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Participants");

        // Add columns
        worksheet.columns = [
            { header: "Name", key: "Name", width: 25 },
            { header: "Email", key: "Email", width: 30 },
            { header: "WhatsApp", key: "WhatsApp", width: 20 },
            { header: "Instagram", key: "Instagram", width: 20 },
            { header: "Source", key: "Source", width: 20 },
            { header: "Counselling Session", key: "Counselling Session", width: 25 },
            { header: "Arrival Time", key: "Arrival Time", width: 20 },
            { header: "Registered Date", key: "Registered Date", width: 25 }
        ];

        // Insert data
        result.rows.forEach(participant => {
            worksheet.addRow(participant);
        });

        // Make header bold
        worksheet.getRow(1).font = {
            bold: true
        };

        // File name
        const filename = `participants_${Date.now()}.xlsx`;

        // Download response
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename=${filename}`
        );

        await workbook.xlsx.write(res);
        res.end();


    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to export Excel");
    }
});


// Manage admins
app.get('/admin/manage-admins', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM admins`
    );

    res.render('admin_manage', {
      admins: result.rows
    });

  } catch (err) {
    console.error(err);
    res.send("❌ Error loading admins");
  }
});

app.post('/admin/manage-admins', isAuthenticated, async (req, res) => {
  const { name, username, password, role } = req.body;
  const id = uuidv4();

  try {
    await pool.query(
      `
      INSERT INTO admins
      (
        id,
        "name",
        username,
        "password",
        "role"
      )
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        id,
        name,
        username,
        password,
        role
      ]
    );

    res.redirect('/admin/manage-admins');

  } catch (err) {
    console.error(err);
    res.send("❌ Error adding admin");
  }
});

app.post('/admin/delete-admin/:id', isAuthenticated, async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query(
      `
      DELETE FROM admins
      WHERE id = $1
      AND "role" != 'superadmin'
      `,
      [id]
    );

    res.redirect('/admin/manage-admins');

  } catch (err) {
    console.error(err);
    res.send("❌ Error deleting admin");
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error(err);
      return res.redirect('/admin/dashboard');
    }

    res.redirect('/admin');
  });
});

// -------------------- START SERVER --------------------
// Health check
app.get('/health', (req, res) => {
  res.json({
    status: "OK"
  });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});