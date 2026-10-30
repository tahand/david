/**
 * User guide text. Images are the screenshots in docs/user-guide/images,
 * captured by capture.spec.ts from the fictional Maple Grove Clinic.
 * Keep wording in step with the UI labels, which are quoted in bold.
 */

const fig = (name: string, caption: string, size: 'full' | 'half' = 'full') =>
  `<figure class="${size}"><img src="images/${name}.png" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;

const tip = (text: string) => `<div class="tip"><strong>Tip</strong> ${text}</div>`;
const note = (text: string) => `<div class="note"><strong>Good to know</strong> ${text}</div>`;

export interface Chapter {
  id: string;
  title: string;
  audience: string;
  html: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'start',
    title: 'Getting started',
    audience: 'Everyone',
    html: `
<h3>Signing in</h3>
<p>Open the clinic's appointment website and enter your email address and password, then select <b>Sign in</b>. Use <b>Show</b> to check your password as you type.</p>
${fig('01-sign-in', 'The sign-in page.')}
<p>If you enter the wrong details, you'll see "Email or password is incorrect". After 10 unsuccessful attempts the account is locked for 15 minutes and we email you; use <b>Forgot password?</b> if you can't remember it.</p>

<h3>Creating a patient account</h3>
<p>Patients can register themselves: on the sign-in page select <b>Create an account</b>. Fill in your name, date of birth, email, mobile number and a password of at least 12 characters. A few unrelated words make a strong password that's easy to remember. Tick the box to accept the privacy notice and terms, then select <b>Create account</b>.</p>
${fig('02-register', 'Registering as a new patient.')}
<p>We'll send you an email with a link. <b>Open it to confirm your email address</b>: you can sign in straight away, but you need to confirm your email before you can book.</p>
${note('Staff accounts are never created here. A practice manager creates them and you receive an email invitation (see "Your first sign-in as staff").')}

<h3>Two-step verification</h3>
<p>Two-step verification protects your account with a code from an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password, as well as your password. It is <b>required for all staff</b> and recommended for patients.</p>
<p><b>Setting it up.</b> Staff are taken to the set-up page the first time they sign in. Patients can start it from the dashboard or from <b>Security</b>. Scan the QR code with your authenticator app (or type in the key shown under it), then enter the 6-digit code the app shows.</p>
${fig('04-mfa-setup', 'Setting up two-step verification.')}
<p>You'll then see <b>10 recovery codes</b>. Download or copy them and keep them somewhere safe: each one lets you sign in once if you lose your phone. They are only shown once.</p>
<p><b>Signing in with a code.</b> After your password, enter the current code from your app. The form submits by itself when you type the sixth digit. Lost your phone? Select <b>Use a recovery code instead</b>.</p>
${fig('05-sign-in-code', 'Entering the code from your authenticator app.', 'half')}

<h3>Forgotten your password</h3>
<p>Select <b>Forgot password?</b> on the sign-in page and enter your email address. If an account exists we'll email a link to choose a new password. The link works once and expires after 30 minutes. Changing your password signs you out on all other devices.</p>
${fig('03-forgot-password', 'Requesting a password reset link.', 'half')}

<h3>Your first sign-in as staff</h3>
<p>When the practice manager adds you, you'll receive an email titled <b>Set up your account</b>. Open the link within 72 hours, choose your password, sign in, and set up two-step verification. Until you do, no other page is available.</p>

<h3>Staying secure</h3>
<ul>
<li>You're signed out automatically after a period of inactivity: 30 minutes for staff, 60 minutes for patients. Two minutes before, a message asks whether you're still there; select <b>Stay signed in</b> to continue.</li>
<li>Select <b>Sign out</b> when you finish, especially on a shared computer.</li>
<li>On <b>Security</b> you can see every device you're signed in on, sign out any of them, or <b>Sign out of all devices</b>.</li>
</ul>
`,
  },
  {
    id: 'patients',
    title: 'For patients',
    audience: 'Patients',
    html: `
<h3>Your dashboard</h3>
<p>After signing in you'll see your next appointment, a <b>Book appointment</b> button, and any reminders, for example to confirm your email address or turn on two-step verification.</p>
${fig('18-dashboard-booked', 'The patient dashboard with the next appointment.')}

<h3>Booking an appointment</h3>
<p>Select <b>Book</b>. Booking takes four short steps:</p>
<ol>
<li><b>Appointment type</b>: choose the kind of appointment. Its length is shown.</li>
${fig('11-book-type', 'Step 1: choose the type of appointment.')}
<li><b>Doctor</b>: choose a doctor, or <b>Any doctor</b> for the earliest times.</li>
${fig('12-book-doctor', 'Step 2: choose a doctor.')}
<li><b>Date and time</b>: available times are shown a week at a time; use <b>Next week</b> to look further ahead. Times are in the clinic's local time.</li>
${fig('13-book-time', 'Step 3: pick a time.')}
<li><b>Confirm</b>: check the details, add a reason for your visit if you like, and select <b>Book appointment</b>.</li>
${fig('14-book-confirm', 'Step 4: confirm the booking.')}
</ol>
${note("You can book from 1 hour to 60 days ahead and hold up to 3 upcoming appointments. The clinic may change these limits. If someone else takes a time while you are booking, you'll be asked to choose another.")}

<h3>Confirmation emails and your calendar</h3>
<p>We email you when you book, move or cancel an appointment, and send a reminder the day before (if you agreed to reminders). Each email includes a calendar file (<b>appointment.ics</b>): open it to add the appointment to your phone or computer calendar. Emails never include medical details.</p>
${fig('21-email-booked', 'A booking confirmation email.')}

<h3>Your appointments</h3>
<p><b>Appointments</b> lists what's coming up and your past and cancelled appointments.</p>
${fig('15-appointments', 'Upcoming and past appointments.')}
<p><b>To move an appointment</b>, select <b>Reschedule</b>, pick a new time and select <b>Move appointment</b>.</p>
${fig('16-reschedule', 'Choosing a new time.')}
<p><b>To cancel</b>, select <b>Cancel</b>, optionally give a reason (please don't include medical details), and confirm.</p>
${fig('17-cancel', 'Cancelling an appointment.', 'half')}
${note('Appointments can be changed online up to 24 hours before they start. After that, please phone the clinic.')}

<h3>Your profile and your data</h3>
<p><b>Profile</b> shows the details the clinic holds about you. Select <b>Edit details</b> to update your name, contact details, address and emergency contact. Your medical summary (allergies, medications and conditions) is kept up to date by the clinic. If something is wrong, tell the clinic.</p>
${fig('19-profile', 'Your profile, medical summary and data download.')}
<p>Under <b>Download your data</b> you can download everything we hold about you, as a PDF or as a data file.</p>

<h3>Security settings</h3>
<p><b>Security</b> lets you change your password, turn two-step verification on or off, get new recovery codes, and see and sign out the devices you're signed in on.</p>
${fig('20-account-security', 'Account security.')}
`,
  },
  {
    id: 'doctors',
    title: 'For doctors',
    audience: 'Doctors',
    html: `
<h3>Your schedule</h3>
<p><b>Schedule</b> opens on today. Switch between <b>Day</b> and <b>Week</b>, and use <b>Previous</b>, <b>Today</b> and <b>Next</b> to move around. Each appointment shows its time, patient, type and status.</p>
${fig('30-doctor-schedule', "A doctor's day.")}

<h3>Seeing a patient</h3>
<p>Select an appointment to open the patient's summary beside your schedule: date of birth, the reason for the visit, their allergies, medications and long-term conditions, and the clinical notes for that appointment.</p>
${fig('31-doctor-appointment', 'An appointment with the medical summary and clinical notes.')}
<p><b>Clinical notes.</b> Type in <b>New note</b> and select <b>Add note</b>. Saved notes can't be edited or deleted: to correct one, select <b>Amend this note</b>, which adds a linked correction and keeps the original. Notes are visible only to doctors.</p>
<p>Use the status buttons to mark a patient as checked in, <b>Completed</b> once they have been seen, or <b>Did not attend</b>.</p>

<h3>Patient records</h3>
<p><b>Patients</b> lets you search by name, date of birth, postcode or phone number. You can see the records of patients who have an appointment with you.</p>
${fig('32-doctor-patient', "A patient's record: details, medical summary and appointment history.")}

<h3>Your working hours</h3>
<p><b>Availability</b> sets when patients can book you. Under <b>Weekly hours</b>, add one or more blocks for each day (for example 08:30–12:30 and 13:30–17:30). Under <b>Time off and extra sessions</b>, add holidays, training days or one-off extra clinics. Existing appointments are never moved automatically; the clinic will contact the patients affected.</p>
${fig('33-availability', 'Weekly hours and time off.')}
`,
  },
  {
    id: 'reception',
    title: 'For reception',
    audience: 'Receptionists',
    html: `
<h3>The front desk</h3>
<p><b>Front desk</b> shows every doctor's appointments for the day side by side. Use <b>Previous day</b>, <b>Today</b> and <b>Next day</b>, or pick a date.</p>
${fig('40-front-desk', "Today's appointments for every doctor.")}
<p>When a patient arrives, select <b>Check in</b> on their appointment. You can also <b>Confirm</b> an appointment (for example after a reminder call) or mark <b>Did not attend</b> once its time has passed.</p>

<h3>Finding a patient</h3>
<p>Select <b>Patients</b> and search by name, date of birth (for example 31/01/1990), postcode or phone number.</p>
${fig('41-patient-search', 'Searching for patients.')}
<p>Open a record to see and edit the patient's details and medical summary, view their appointments, and select <b>Book appointment</b> to book for them. Booking works like the patient's four steps, and the patient is emailed if we have an address for them.</p>
${fig('42-patient-record', 'A patient record.')}
${note('Reception staff can see and update the medical summary but not clinical notes, which are for doctors only.')}

<h3>Adding a patient</h3>
<p>For patients who don't use the website, select <b>Add patient</b> on the Patients page, fill in their details, and add a contact email if they'd like confirmations and reminders.</p>
${fig('43-new-patient', 'Adding a patient record.')}
`,
  },
  {
    id: 'admin',
    title: 'For practice managers',
    audience: 'Admins',
    html: `
<h3>Staff accounts</h3>
<p><b>Users</b> lists every account. Search by email or doctor's name, and filter by role or status. Badges show accounts that are deactivated, waiting for the person to accept their invitation, locked after failed sign-ins, or without two-step verification.</p>
${fig('50-admin-users', 'All accounts.')}
<p><b>Adding staff.</b> Select <b>Add staff member</b>, enter their work email and role. For doctors, also enter the name patients will see and whether patients can book them online. They'll be emailed a link to choose their password. You never set or see anyone's password.</p>
${fig('51-admin-new-staff', 'Adding a doctor.')}
<p><b>Managing an account.</b> Open an account to change the role, edit a doctor's profile, or:</p>
<ul>
<li><b>Reset password</b>: their current password stops working, they are signed out everywhere, and they're emailed a link to choose a new one.</li>
<li><b>Reset two-step verification</b>: for a lost phone. Check who you're speaking to first. Staff must set it up again at their next sign-in.</li>
<li><b>Deactivate</b>: stops the account signing in and signs it out everywhere. Records and history are kept. Do this on the day someone leaves.</li>
</ul>
${fig('52-admin-user', "An account's details and actions.")}
${note("You can't change your own role or deactivate yourself, and there must always be at least one active admin. A doctor with upcoming appointments can't be deactivated until their appointments are moved or cancelled.")}

<h3>Appointment types</h3>
<p>Set the types of appointment the clinic offers, their length and colour, and whether patients can book them online. Retire a type by unticking <b>Available for new bookings</b>; it stays on past appointments. Changes affect new bookings only.</p>
${fig('53-admin-types', 'Appointment types.')}

<h3>Clinic settings</h3>
<p><b>Settings</b> holds the clinic's name, address and phone (shown in emails and calendar invitations), the label for the health ID (for example NHS number), the booking rules, how long deleted records are kept, the privacy notice version, and the colour theme.</p>
${fig('54-admin-settings', 'Clinic settings.')}
${tip("When you publish a new privacy notice or terms, update <b>Privacy notice and terms version</b>. Each patient's consent is recorded against the version they accepted.")}

<h3>Audit log</h3>
<p>Every sign-in, change to an account, view or change of a patient record, clinical note, appointment change and admin action is recorded. Filter by who did it, which record, the action (for example <b>auth.</b> for all sign-in events) and dates. The audit log can't be changed or deleted, and viewing it is itself recorded.</p>
${fig('55-admin-audit', 'The audit log.')}
`,
  },
  {
    id: 'help',
    title: 'Help and questions',
    audience: 'Everyone',
    html: `
<dl class="faq">
<dt>I've been locked out after too many attempts.</dt>
<dd>Wait 15 minutes and try again, or reset your password with <b>Forgot password?</b>. If you didn't make those attempts, reset your password.</dd>
<dt>I've lost my phone with my authenticator app.</dt>
<dd>Sign in with one of your recovery codes, then set up two-step verification on your new phone from <b>Security</b>. No recovery codes? Staff should ask a practice manager to reset it; patients should contact the clinic.</dd>
<dt>"Too many requests. Please wait and try again."</dt>
<dd>There's a limit on how many sign-in attempts can come from one network in a minute. Wait a minute and try again.</dd>
<dt>I can't reschedule or cancel my appointment online.</dt>
<dd>Changes close 24 hours before the appointment. Please phone the clinic.</dd>
<dt>I'm not receiving emails.</dt>
<dd>Check your spam folder and that your email address is correct on your <b>Profile</b>. Reminders are only sent if you agreed to them.</dd>
<dt>Is my information safe?</dt>
<dd>Connections are encrypted, sensitive medical information is encrypted when stored, staff must use two-step verification, and every access to patient records is recorded. Doctors can only see the records of patients they have appointments with.</dd>
<dt>Can I use it on my phone?</dt>
<dd>Yes. Every page works on phones and tablets, with no app to install.</dd>
</dl>
`,
  },
];
