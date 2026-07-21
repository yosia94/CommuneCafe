const sqlite3 = require("sqlite3").verbose();
const pg = require("./postgres");

const sqliteDb = new sqlite3.Database("./commune_cafe.db");

const tables = [
  {
    name: "admins",
    columns: ["id", "role", "name", "username", "password", "created_at"],
  },
  {
    name: "email_templates",
    columns: [
      "id",
      "confirmation_subject",
      "confirmation_body",
      "reminder_subject",
      "reminder_body",
      "updated_at",
      "updated_by",
    ],
  },
  {
    name: "event_settings",
    columns: [
      "id",
      "header_message",
      "date",
      "start_time",
      "end_time",
      "place",
      "bottom_message",
    ],
  },
  {
    name: "welcome_message",
    columns: ["id", "message"],
  },
  {
    name: "registrations",
    columns: [
      "id",
      "participants_name",
      "participants_email",
      "participants_wa",
      "source",
      "counselling_session",
      "participants_ig",
      "time_arrival",
      "created_date",
    ],
  },
];

async function migrateTable(table) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(`SELECT * FROM ${table.name}`, async (err, rows) => {
      if (err) return reject(err);

      console.log(`Migrating ${table.name} (${rows.length} rows)...`);

      try {
        for (const row of rows) {
          const values = table.columns.map((c) => row[c]);
          const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

          await pg.query(
			`INSERT INTO ${table.name}
			(${table.columns.join(",")})
			VALUES (${placeholders})
			ON CONFLICT (id) DO NOTHING`,
			values
			);
        }

        console.log(`✅ ${table.name} completed`);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

(async () => {
  try {
    for (const table of tables) {
      await migrateTable(table);
    }

    console.log("\n🎉 ALL TABLES MIGRATED SUCCESSFULLY!");
  } catch (err) {
    console.error(err);
  } finally {
    sqliteDb.close();
    await pg.end();
  }
})();