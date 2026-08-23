require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const passport = require('./auth');
const db = require('./db');
const MySqlSessionStore = require('./session-store');
const { processScanDocument, verifyDocumentAiConfiguration } = require('./document-ai');
const { sendVerificationEmail, smtpLogConfig, verifyMailConfiguration, buildVerificationEmailContent, sendPasswordResetEmail, sendClassMessageEmail, sendCatechistInvitationEmail, sendTemporaryPasswordEmail } = require('./mailer');
const { requireAuth, requireRole } = require('./middleware');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
console.info('[startup] Mail configuration', {
  host: smtpLogConfig.host,
  port: smtpLogConfig.port,
  secure: smtpLogConfig.secure,
  hasUser: smtpLogConfig.hasUser,
  hasPass: smtpLogConfig.hasPass,
  from: smtpLogConfig.from,
  appBaseUrl: process.env.APP_BASE_URL || '',
});
const STUDENT_REGISTRATION_STATUSES = [
  'in_progress',
  'conditionally_accepted',
  'admitted',
  'completed',
  'cancelled',
  'discontinued',
  'graduated',
];

const translations = {
  en: {
    app_title: 'Saint Matthew Catholic Church',
    reg_title: 'Register for Faith Formation and Sacramental Preparation',
    school_year: 'School Year',
    landing_focus_title: 'Faith Formation & Sacramental Readiness',
    landing_focus_subtitle: 'For children, OCIA candidates, and adult faith formation events',
    secure_online: 'Create an account or sign in to see registration forms for families, catechists, administrators, and formation participants',
    create_account: 'Create Account',
    login: 'Login',
    logout: 'Logout',
    open_dashboard: 'Open Dashboard',
    dashboard: 'Dashboard',
    my_account: 'My Account',
    account_profile: 'Account Profile',
    account_profile_subtitle: 'Your sign-in and profile information.',
    profile_information: 'Profile Information',
    account_security: 'Account Security',
    my_uploads: 'My Uploads',
    user_uploads: 'User Uploads',
    uploaded_documents: 'Uploaded Documents',
    uploaded_documents_subtitle: 'Files attached to your registrations.',
    no_uploads: 'No uploaded files are associated with your account yet.',
    document_type: 'Document Type',
    registration: 'Registration',
    signed_in_as: 'Signed in as',
    new_registration: 'New Registration',
    calendar: 'Calendar',
    manage_users: 'Admin Panel',
    manage_visit_availability: 'Manage Visit Availability',
    submitted_registrations: 'Submitted Registrations',
    student: 'Student',
    grade: 'Grade',
    parent: 'Parent / Guardian',
    primary_contact: 'Primary Contact',
    total_fees: 'Total Fees',
    certificates: 'Certificates',
    baptism: 'Baptism',
    communion: 'Communion',
    user_administration: 'User Administration',
    user_registrations: 'User Registrations',
    view_registrations: 'View Registrations',
    associated_registrations: 'Associated Registrations',
    associated_registrations_subtitle: 'Registrations connected to this user account.',
    back_to_dashboard: 'Back to Dashboard',
    email: 'Email',
    file: 'File',
    phone: 'Phone',
    account_status: 'Account Status',
    active_status: 'Active',
    inactive_status: 'Inactive',
    verified_status: 'Verified',
    not_verified_status: 'Not verified',
    sign_in_method: 'Sign-in Method',
    member_since: 'Member Since',
    role: 'Role',
    provider: 'Provider',
    update_role: 'Update Role',
    save: 'Save',
    create_login: 'Create Account',
    full_name: 'Full Name',
    first_name: 'First Name',
    last_name: 'Last Name',
    password: 'Password',
    forgot_password: 'Forgot password?',
    forgot_password_intro: "Enter your email and we'll send you a link to reset your password.",
    send_reset_link: 'Send Reset Link',
    back_to_login: 'Back to login',
    check_your_email: 'Check your email',
    forgot_password_sent_intro: "If an account exists for that address, we've sent a password reset link to",
    reset_password: 'Reset Password',
    new_password: 'New Password',
    confirm_new_password: 'Confirm New Password',
    password_min_length: 'Must be at least 8 characters.',
    change_password: 'Change Password',
    current_password: 'Current Password',
    update_password: 'Update Password',
    role_request: 'Role',
    invite_code: 'Invite Code (required for admin/catechist)',
    already_have_account: 'Already have an account?',
    continue_free_providers: 'Or continue with free providers:',
    need_account: 'Need an account?',
    sign_up: 'Sign up',
    registration_form_title: 'Faith Formation Registration — Children',
    back: 'Back',
    primary_parent_contact: 'Parent / Guardian Contact',
    primary_contact_phone: 'Contact Phone',
    primary_contact_email: 'Contact Email',
    relationship: 'Relationship to Child',
    relationship_other: 'If Other, please describe',
    father: 'Father',
    mother: 'Mother',
    stepfather: 'Stepfather',
    stepmother: 'Stepmother',
    grandfather: 'Grandfather',
    grandmother: 'Grandmother',
    grandparents: 'Grandparents',
    other_lives_with: 'Other',
    other: 'Other',
    address: 'Street Address',
    city: 'City',
    state: 'State',
    zip: 'Zip Code',
    address_information: 'Address Information',
    city_state_zip: 'City, State & Zip',
    home_phone: 'Home Phone',
    primary_contact_religion: 'Primary Contact Religion',
    father_name: "Father's Name",
    father_religion: 'Father Religion',
    father_cell: "Father's Cell Phone",
    mother_maiden_name: "Mother's Maiden Name",
    mother_religion: 'Mother Religion',
    mother_cell: "Mother's Cell Phone",
    child_lives_with: 'Child Lives With',
    both: 'Both',
    step_parent_name: 'Step-Parent Name',
    step_parent_religion: 'Step-Parent Religion',
    student_full_name: "Student's Full Name",
    student_first_name: 'Student First Name',
    student_middle_name: 'Student Middle Name',
    student_last_name: 'Student Last Name',
    birth_city: 'Birth City',
    birth_country: 'Birth Country',
    gender: 'Gender',
    male: 'Male',
    female: 'Female',
    age: 'Age',
    dob: 'Date of Birth',
    place_of_birth: "Child's Place of Birth",
    ccd_grade_level: 'CCD Grade Level (Class Code)',
    school_grade_level: 'School Grade Level',
    school_attending: 'School Attending',
    baptism_date: 'Baptism Date',
    baptism_church: 'Baptism Church / City / State',
    first_communion_date: 'First Communion Date',
    first_communion_church: 'First Communion Church / City / State',
    comments: 'Disabilities / Learning Needs / Comments',
    family_count: 'Number of children in family (for fee calculation)',
    parent_signature: 'Signature of Parent / Guardian',
    first_name: 'First Name',
    last_name: 'Last Name',
    upload_scans: 'Upload Certificate Scans',
    multiple_files_hint: 'Select one or more files if the certificate has multiple pages.',
    add_file: 'Add file',
    remove_file: 'Remove file',
    baptism_required: 'Baptism Certificate (required if first year)',
    communion_required: 'First Holy Communion Certificate (required for 3rd grade+)',
    fee_notice: 'Fees: $150 one child / $200 family; sacramental fee $25 for second grade/SS2, $50 for second-year Confirmation.',
    submit_registration: 'Submit Registration',
    cancel: 'Cancel',
    footer_note: 'Please verify all sacramental records before submission. Contact the parish office with questions.',
    language: 'Language',
    english: 'English',
    spanish: 'Spanish',
    registration_date_auto: 'Registration Date (auto-set by system)',
    register_child: 'Register Child for Faith Formation',
    register_adult: 'Register for Adult Program',
    phone: 'Phone',
    // Dashboard
    new_registration_heading: 'New Registration',
    childrens_programs: "Children's Programs",
    family_programs: 'Family Programs',
    adult_programs: 'Adult Programs',
    no_children_regs: 'No children\'s registrations yet.',
    no_family_regs: 'No family faith formation registrations yet.',
    no_adult_regs: 'No adult program registrations yet.',
    faith_formation_children: 'Faith Formation — Children',
    family_faith_registrations: 'Family Faith Formation Registrations',
    adult_program_regs: 'Adult Program Registrations',
    name_col: 'Name',
    program_col: 'Program',
    date_col: 'Date',
    members_col: 'Members',
    family_name: 'Family Name',
    family_primary_contact: 'Primary Contact',
    family_badges: 'Sacramental Needs',
    family_badges_none: 'No sacramental needs listed.',
    visit: 'Visit',
    visit_window: 'Visit Window',
    assigned_leader: 'Assigned Leader',
    // Program cards
    prog_children_title: 'Faith Formation for Children',
    prog_children_subtitle: 'Faith Formation Year',
    prog_children_desc: 'Register a child for CCD classes, sacramental preparation (First Communion, Confirmation), and weekly faith formation.',
    prog_family_title: 'Family Faith Formation',
    prog_family_subtitle: 'Whole Household Registration',
    prog_family_desc: 'Register one family together and track each member\'s sacramental needs with badges for Baptism, First Reconciliation, First Holy Communion, and Confirmation.',
    prog_ocia_title: 'Adult OCIA',
    prog_ocia_subtitle: 'Order of Christian Initiation',
    prog_ocia_desc: 'For adults who are not yet Catholic and wish to explore or enter the Catholic faith through the sacraments of initiation.',
    prog_baptism_title: 'Baptism Preparation',
    prog_baptism_subtitle: 'Parents & Godparents',
    prog_baptism_desc: 'Required preparation class for parents and godparents of infants or children to be baptized at St. Matthew.',
    prog_confirm_title: 'Adult Confirmation',
    prog_confirm_subtitle: 'Completing Initiation',
    prog_confirm_desc: 'For baptized Catholics who have not yet received the Sacrament of Confirmation and wish to complete their initiation.',
    // Adult registration form
    your_information: 'Your Information',
    are_you_baptized: 'Are you Baptized?',
    select_placeholder: '— Select —',
    baptized_yes_catholic: 'Yes, Catholic',
    baptized_yes_other: 'Yes, another Christian tradition',
    baptized_no: 'No',
    baptized_unsure: 'Not sure',
    baptism_details: 'Baptism Details',
    name_of_person_baptized: 'Name of child / person to be baptized',
    your_role: 'Your role',
    role_parent: 'Parent',
    role_godparent: 'Godparent / Sponsor',
    role_both: 'Both parent and godparent',
    class_date: 'Class Date',
    choose_class_date: 'Choose Baptism Preparation Class Date',
    no_class_dates_available: 'No class dates are currently available. Please contact the parish office.',
    baptism_prep_dates: 'Baptism Preparation Dates',
    add_class_date: 'Add Class Date',
    configured_class_dates: 'Configured Class Dates',
    class_time: 'Class Time',
    classroom: 'Classroom',
    ccd_classes: 'Faith Formation Events',
    add_ccd_class: 'Add Class',
    configured_ccd_classes: 'Configured Classes',
    grade_level: 'Event Name',
    no_ccd_classes: 'No faith formation events configured yet.',
    manage_events: 'Manage Events',
    faith_formation_events: 'Faith Formation Events',
    event_definitions: 'Event Definitions',
    event_schedule: 'Event Schedule',
    schedule_event: 'Schedule Event',
    schedule_type: 'Schedule Type',
    one_time_event: 'One-Time Event',
    recurring_event: 'Recurring Event',
    recurrence_pattern: 'Recurrence Pattern',
    weekday: 'Weekday',
    add_event: 'Add Event',
    event_title: 'Event Title',
    event_date: 'Event Date',
    event_time: 'Event Time',
    event_end_time: 'End Time',
    event_location: 'Location',
    audience: 'Audience',
    no_events_configured: 'No events configured yet.',
    no_event_definitions: 'No event definitions created yet.',
    children_faith_formation: "Children's Faith Formation",
    general_events: 'General Events for Everyone',
    monthly_calendar: 'Monthly Calendar',
    no_events_this_month: 'No scheduled events for this month.',
    previous_month: 'Previous Month',
    next_month: 'Next Month',
    remove: 'Remove',
    spouse_coparent_name: 'Spouse / Co-parent name',
    if_attending_together: '(if attending together)',
    sacramental_history: 'Sacramental History',
    church_where_baptized: 'Church where you were baptized',
    church_placeholder: 'Church name, City, State',
    baptism_date_approx: 'Baptism date',
    approx_ok: '(approx. ok)',
    received_first_communion: 'Have you received First Communion?',
    family_registration_form_title: 'Family Faith Formation Registration',
    family_household: 'Household Information',
    family_members: 'Family Members',
    add_family_member: 'Add Family Member',
    remove_member: 'Remove',
    member_first_name: 'Member First Name',
    member_last_name: 'Member Last Name',
    member_role: 'Role in Family',
    member_dob: 'Date of Birth',
    member_notes: 'Member Notes',
    household_notes: 'Household Notes',
    sacramental_needs: 'Sacramental Needs',
    choose_visit: 'Choose a Visit',
    no_visit_slots: 'No Visit slots are currently available. Please contact the parish office.',
    visit_help: 'Choose a 30-minute Visit window with a family faith formation leader.',
    family_faith_leader: 'Family Faith Formation Leader',
    leader: 'Leader',
    available_visit_slots: 'Available Visit Slots',
    add_visit_slots: 'Add Visit Slots',
    visit_date: 'Visit Date',
    start_time: 'Start Time',
    end_time: 'End Time',
    your_visit_availability: 'Your Visit Availability',
    configured_visit_slots: 'Configured Visit Slots',
    no_visit_slots_configured: 'No Visit slots have been configured yet.',
    slots_created: 'Visit slots created.',
    visit_slot_removed: 'Visit slot removed.',
    visit_slot_required: 'Please choose an available Visit slot.',
    first_holy_communion: 'First Holy Communion',
    first_reconciliation: 'First Reconciliation',
    confirmation: 'Confirmation',
    role_child_member: 'Child',
    role_parent_member: 'Parent',
    role_guardian_member: 'Guardian',
    role_grandparent_member: 'Grandparent',
    role_other_member: 'Other',
    yes: 'Yes',
    no: 'No',
    questions_comments: 'Questions or Comments',
    comments_placeholder: "Any questions, scheduling constraints, or other information you'd like us to know",
    // Signup
    are_you_staff: 'Are you a parish staff member?',
    i_am_catechist: 'I am a Catechist',
    catechist_desc: 'Faith formation teacher or volunteer instructor',
    i_am_admin: 'I am a Program Administrator',
    admin_desc: 'Parish staff managing the faith formation program',
    leave_unchecked: 'Leave both unchecked to register as a regular user (families, parishioners).',
    contact_parish_code: 'Contact the parish office if you need an invite code.',
    invite_placeholder: 'Enter the invite code provided by the parish office',
    // Registration form
    student_info: 'Student Information',
    sacramental_records: 'Sacramental Records',
    total_fees_due: 'Total Fees Due',
    pay_registration_fee_online: 'Pay Registration Fee Online',
    how_many_children_ccd: 'How many children are you registering for CCD?',
    phone_format_hint: 'Format: 123-456-7890 or 123.456.7890 or 123 456 7890',
    invalid_phone_feedback: 'Please enter a valid phone number (XXX-XXX-XXXX format).',
    invalid_email_feedback: 'Please enter a valid email address.',
    religion_catholic: 'Catholic',
    religion_non_denominational: 'Non-denominational',
    religion_protestant: 'Protestant',
    religion_muslim: 'Muslim',
    religion_hindu: 'Hindu',
    religion_buddhist: 'Buddhist',
    religion_agnostic: 'Agnostic',
    religion_atheist: 'Atheist',
    state_AL: 'Alabama', state_AK: 'Alaska', state_AZ: 'Arizona', state_AR: 'Arkansas',
    state_CA: 'California', state_CO: 'Colorado', state_CT: 'Connecticut', state_DE: 'Delaware',
    state_FL: 'Florida', state_GA: 'Georgia', state_HI: 'Hawaii', state_ID: 'Idaho',
    state_IL: 'Illinois', state_IN: 'Indiana', state_IA: 'Iowa', state_KS: 'Kansas',
    state_KY: 'Kentucky', state_LA: 'Louisiana', state_ME: 'Maine', state_MD: 'Maryland',
    state_MA: 'Massachusetts', state_MI: 'Michigan', state_MN: 'Minnesota', state_MS: 'Mississippi',
    state_MO: 'Missouri', state_MT: 'Montana', state_NE: 'Nebraska', state_NV: 'Nevada',
    state_NH: 'New Hampshire', state_NJ: 'New Jersey', state_NM: 'New Mexico', state_NY: 'New York',
    state_NC: 'North Carolina', state_ND: 'North Dakota', state_OH: 'Ohio', state_OK: 'Oklahoma',
    state_OR: 'Oregon', state_PA: 'Pennsylvania', state_RI: 'Rhode Island', state_SC: 'South Carolina',
    state_SD: 'South Dakota', state_TN: 'Tennessee', state_TX: 'Texas', state_UT: 'Utah',
    state_VT: 'Vermont', state_VA: 'Virginia', state_WA: 'Washington', state_WV: 'West Virginia',
    state_WI: 'Wisconsin', state_WY: 'Wyoming',
    continue_to_student_info: 'Continue to Student Info',
    not_baptized_checkbox_label: 'This child is not baptized',
    sacramental_preparation_legend: 'Sacramental Preparation',
    registering_child_for: 'What are you registering this child for?',
    sacramental_prep_year: 'Sacramental Preparation Year',
    non_sacramental_year: 'Non-Sacramental Year',
    which_sacrament: 'Which sacrament?',
    holy_communion: 'Holy Communion',
    which_year: 'Which year?',
    first_year_of: 'First Year of',
    second_year_of: 'Second Year of',
    attended_first_year_prefix: 'This child has attended the first year of',
    preparation_word: 'preparation',
    check_box_above_enable: '(check the box above to enable)',
    first_year_info_notice: 'Parents are invited to join this journey of sacramental preparation for children by joining them in this program. These sessions will be slightly longer but less frequent (approximately 11 meetings until May).',
    what_grade_ccd: 'What grade is this child in for CCD?',
    preferred_class_time: 'Preferred Class Time',
    not_yet_scheduled: 'Not yet scheduled — contact the parish office.',
    save_and_continue: 'Save & Continue',
    back_to_previous_student: 'Back to Previous Student',
    back_to_parent_info: 'Back to Parent Info',
    fee_schedule_label: 'Fee Schedule',
    not_baptized_ask_dob: "Enter the child's date of birth above to determine whether First Year of Holy Communion or First Year of Confirmation applies.",
    not_baptized_only_option_prefix: 'Since this child is not yet baptized, First Year of',
    not_baptized_only_option_suffix: 'is the only option available, based on age.',
    wizard_parent_info_child1: 'Parent Info & Child 1',
    wizard_child_word: 'Child',
    wizard_of_word: 'of',
    wizard_step_word: 'Step',
    name: 'Name',
    time: 'Time',
    room: 'Room',
    location: 'Location',
    notes: 'Notes',
    child_col: 'Child',
    contact_col: 'Contact',
    submitted_col: 'Submitted',
    unassigned: 'Unassigned',
    select_event: 'Select event',
    select_weekday: 'Select weekday',
    select_classroom: 'Select classroom',
    current_badge: 'Current',
    open_status: 'Open',
    closed_status: 'Closed',
    tab_users: 'Users',
    tab_settings: 'Settings',
    tab_event_scheduler: 'Event Scheduler',
    tab_eucharistic_adoration: 'Eucharistic Adoration',
    filter_by_user_type: 'Filter by user type',
    all_users: 'All Users',
    role_user: 'User',
    role_catechist: 'Catechist',
    role_admin: 'Admin',
    user_singular: 'user',
    user_plural: 'users',
    search_users_placeholder: 'Search by name or email',
    filter_by_status: 'Filter by status',
    all_statuses: 'All statuses',
    change_role: 'Change role',
    more_actions: 'More actions',
    previous_page: 'Previous',
    next_page: 'Next',
    page_x_of_y: 'Page {page} of {total}',
    invite_catechist_header: 'Invite a Catechist',
    invite_catechist_desc: 'Create a Catechist account and send an activation link so they can set their own password.',
    invite_full_name_label: 'Full Name',
    invite_email_label: 'Email',
    invite_phone_label: 'Phone (optional)',
    invite_catechist_submit: 'Send Invitation',
    create_user_header: 'Create a User',
    create_user_desc: 'Create an account with a temporary password. They can log in immediately and will be asked to set a new password on first login.',
    create_user_role_label: 'Role',
    create_user_submit: 'Create User',
    verified_status: 'Verified',
    pending_status: 'Pending',
    confirmed_status: 'Confirmed',
    preview_email: 'Preview Email',
    resend: 'Resend',
    reset_password_btn: 'Reset Password',
    deleted_status: 'Deleted',
    mark_deleted_user: 'Mark Deleted',
    restore_user: 'Restore Account',
    confirm_remove_user: 'Mark this user account as deleted? Existing registrations and records will remain.',
    faith_formation_registration_header: 'Faith Formation Registration',
    current_registration_year: 'Current Registration Year',
    set_current_registration_year: 'Set Current Registration Year',
    current_registration_year_label: 'Current registration year:',
    registration_year_toggle_notice: 'Opening and closing is controlled per year below, so you can keep 2025-2026 open while 2026-2027 stays closed.',
    registration_availability_by_year: 'Registration Availability By Year',
    school_year_col: 'School Year',
    faith_formation_col: 'Faith Formation',
    sponsor_form_col: 'Sponsor Form',
    catechist_assignments_header: 'Catechist Assignments',
    preferred_class_time_notice: 'These classes drive the "Preferred Class Time" shown to parents during sacramental prep registration — grade 1–9 has a fixed meaning (below) so the two stay in sync.',
    class_time_label: 'Class Time',
    class_time_placeholder: 'e.g. Monday 4:00-5:15 PM',
    room_placeholder: 'e.g. Room 101',
    add_class: 'Add Class',
    no_ccd_classes: 'No CCD classes have been configured yet.',
    class_col: 'Class',
    assigned_catechist_col: 'Assigned Catechist',
    confirm_remove_class: 'Remove this class? It will no longer appear as a preferred-time option.',
    altar_training_dates_header: 'Altar Server Training Dates',
    training_date_label: 'Training Date',
    location_placeholder_parish_center: 'e.g. Parish Center',
    notes_placeholder_optional: 'Optional details',
    add_training_date: 'Add Training Date',
    no_altar_training_dates: 'No altar server training dates have been scheduled yet.',
    date_time_col: 'Date & Time',
    confirm_remove_training_date: 'Remove this training date?',
    altar_signups_header: 'Altar Server Signups',
    no_altar_signups: 'No altar server signups yet.',
    parent_guardian_col: 'Parent / Guardian',
    preferred_training_col: 'Preferred Training',
    dob_prefix: 'DOB:',
    no_preference: 'No preference',
    confirm_remove_altar_signup: 'Remove this altar server signup?',
    adoration_calendar_header: 'Eucharistic Adoration Calendar',
    available_date_label: 'Available Date',
    start_time_label: 'Start Time',
    end_time_label: 'End Time',
    add_available_date: 'Add Available Date',
    no_adoration_dates: 'No Eucharistic Adoration dates have been configured yet.',
    time_window_col: 'Time Window',
    signups_col: 'Signups',
    confirm_remove_adoration_date: 'Remove this available adoration date? Existing signup records for that day will remain for review.',
    adoration_signups_header: 'Eucharistic Adoration Signups',
    no_adoration_signups: 'No Eucharistic Adoration signups yet.',
    time_slot_col: 'Time Slot',
    confirm_remove_adoration_signup: 'Remove this adoration signup and reopen the slot?',
    registrations_title: 'Registrations',
    all_registrations_header: 'All Registrations',
    all_registrations_subtitle: 'Every family, child, adult, and sponsor confirmation submission across the parish.',
    export_registrations_csv: 'Export CSV',
    filter_by_grade: 'Filter by grade',
    all_grades: 'All Grades',
    no_grade_match: 'No registrations match this grade.',
    filter_by_parent: 'Filter by parent',
    parent_filter_placeholder: 'Parent name or email',
    apply_filters: 'Apply filters',
    clear_filters: 'Clear filters',
    no_registrations_match_filters: 'No registrations match these filters.',
    archive: 'Archive',
    confirm_delete_registration_prefix: 'Permanently delete the registration for',
    confirm_delete_registration_suffix: 'This cannot be undone.',
    archived_children_registrations_header: 'Archived Children Registrations',
    archived_adult_registrations_header: 'Archived Adult Registrations',
    no_archived_registrations: 'No archived registrations.',
    archived_col: 'Archived',
    unarchive: 'Unarchive',
    sponsor_confirmation_forms_header: 'Sponsor Confirmation Forms',
    sponsor_form_certificate_upload: 'Sponsor Certificate',
    no_sponsor_forms: 'No sponsor confirmation forms yet.',
    confirmation_name_col: 'Confirmation Name',
    sponsor_col: 'Sponsor',
    certificate_col: 'Certificate',
    verification_col: 'Verification',
    st_matthew_parishioner: 'St. Matthew parishioner',
    view_file: 'View File',
    view_files_count: 'View files (%s)',
    certificate_files: 'Certificate Files',
    close: 'Close',
    admin_verified: 'Admin verified',
    pending_admin_review: 'Pending admin review',
    certificate_provided: 'Certificate provided',
    missing_certificate: 'Missing certificate',
    verify: 'Verify',
    certificates_verified_label: 'Certificates verified',
    tuition_paid_label: 'Tuition paid',
    parent_contacted_label: 'Parent contacted',
    child_verification_col_header: 'Verification',
    verified_by_on: 'by %s on %s',
    confirm_delete_sponsor_form: 'Delete this sponsor confirmation form? This is helpful for removing test entries.',
    total_fees_due_all_active: 'Total Fees Due — all active registrations',
    registration_fee_col: 'Registration',
    sacramental_fee_col: 'Sacramental',
    late_fee_col: 'Late',
    subtotal_col: 'Subtotal',
    already_have_prefix: 'You already have',
    registration_singular: 'a registration',
    registrations_word: 'registrations',
    on_file_for_suffix: 'on file for:',
    check_my_registrations_prefix: 'Check',
    my_registrations_tab: 'My Registrations',
    check_my_registrations_suffix: 'below before starting a new one to avoid registering the same child twice.',
    view_my_registrations: 'View My Registrations',
    admin_area: 'Admin Area',
    program_registrations_tab: 'Program Registrations',
    sponsor_ministry_signups_tab: 'Sponsor & Ministry Signups',
    registration_closed_notice: 'Registration is currently closed. Contact the parish office or wait for an admin to open this year.',
    confirmation_sponsor_form_title: 'Confirmation Sponsor Form',
    student_sponsor_subtitle: 'Student / Sponsor',
    sponsor_form_desc: 'Enter and save sponsor confirmation information, including sponsor address and signatures.',
    sponsor_form_unavailable: 'Unavailable until the Sponsor Form is opened by an administrator.',
    altar_server_signup_title: 'Altar Server Signup',
    ministry_subtitle: 'Ministry',
    altar_server_signup_desc: 'Sign up your child to serve at the altar at Saint Matthew Catholic Church. Training provided.',
    required_field: 'This field is required.',
    classes_nav: 'Classes',
    classes_header: 'Classes',
    classes_subtitle: 'Rosters, parent contacts, and the schedule for each faith formation class.',
    no_classes_configured_yet: 'No classes have been configured yet.',
    student_count_singular: 'student',
    student_count_plural: 'students',
    next_label: 'Next',
    back_to_classes: 'Back to Classes',
    roster_label: 'Roster',
    class_teacher_label: 'Teacher',
    schedule_label: 'Schedule',
    attendance_label: 'Attendance',
    present_label: 'Present',
    absent_label: 'Absent',
    unmarked_label: 'unmarked',
    no_students_in_class: 'No students match this class yet.',
    pending_acceptance_label: 'Pending',
    pending_count_label: 'pending',
    section_col: 'Section',
    section_label_placeholder: 'e.g. A',
    my_classes_nav: 'My Classes',
    catechists_more_suffix: 'more',
    show_all_label: 'Show all',
    show_less_label: 'Show less',
    send_message_label: 'Send a Message',
    select_all_label: 'Select all',
    select_none_label: 'Select none',
    selected_suffix_label: 'selected',
    subject_label: 'Subject (optional)',
    subject_placeholder: 'e.g. Reminder for this Sunday',
    message_label: 'Message',
    message_placeholder: 'Type your message to parents here...',
    send_message_button: 'Send Message',
    register_family: 'Register Family for Faith Formation',
    // Index accordion
    family_centered_title: 'A Family-Centered Vision',
    family_centered_body: 'Faith is best learned and lived within the family. Rather than seeing religious education as only a classroom experience for children, St. Matthew Parish supports families by providing formation opportunities for both parents and children, resources to help families practice and discuss their faith at home, and parish gatherings that foster prayer, learning, and community.',
    family_centered_note: 'This approach reflects the Church\'s teaching that the family is the "domestic church," where the faith is first experienced and shared.',
    parish_family_title: 'Parish and Family Working Together',
    parish_family_body: 'Faith formation at St. Matthew Parish is a partnership between the parish community and the family. Families participate in periodic family catechesis gatherings, sacramental preparation programs, opportunities for prayer, fellowship, and service, and faith-centered activities that strengthen family and community bonds.',
    sacramental_prep_title: 'Sacramental Preparation',
    sacramental_prep_body: 'Preparation for the Sacraments—especially First Reconciliation, First Holy Communion, and Confirmation—is an important part of our faith formation process. Parents are actively involved through retreats, parish sessions, and home-based formation.',
    missionary_title: 'Growing as Missionary Disciples',
    missionary_body: 'Through prayer, catechesis, community life, and service, we strive to help our parish community develop a personal relationship with Jesus Christ, grow in love for Sacred Scripture and the Sacraments, experience the support of the parish community, and live the Gospel through service and witness.',
    about_heading: 'Faith Formation at St. Matthew Parish',
    about_intro: 'At St. Matthew Catholic Church, faith formation is more than a program—it is a journey of growing as disciples of Jesus Christ. Our parish seeks to help children, parents, and families deepen their relationship with Christ and live their Catholic faith in everyday life.',
    about_intro2: 'Inspired by the vision of Family Faith Formation Catholic Ministries, St. Matthew Parish embraces a family-centered approach to faith formation, recognizing parents as the first and most important teachers of the faith.',
    // Admin
    manage_roles_desc: 'Manage roles and access for all registered users',
    scan_legacy_form: 'Scan Legacy Form',
    scan_legacy_desc: 'Use your phone camera to capture an older paper registration and prefill a draft.',
    open_scanner: 'Open Scanner',
    camera_capture: 'Camera Capture',
    extract_text: 'Extract Text',
    processing_scan: 'Processing scan with Google Document AI...',
    scan_google_ready: 'Google Document AI',
    document_ai_health: 'Document AI Health',
    document_ai_failed: 'Unable to process the scanned document.',
    ocr_text: 'Scanned Text',
    review_imported_fields: 'Review Imported Fields',
    open_registration_draft: 'Open Registration Draft',
    imported_draft_ready: 'Imported draft saved. Review and submit the registration form.',
    // Status
    status: 'Status',
    current_status: 'Current Status',
    update_status: 'Update Status',
    status_updated: 'Registration status updated.',
    save_draft: 'Save Draft',
    actions: 'Actions',
    edit: 'Edit',
    sponsor_form_title_2026: 'Confirmation Sponsor Information Form 2026',
    sponsor_form_kicker: 'Confirmation Preparation',
    sponsor_form_intro: 'Prepare this step with clarity and reverence. Record the sponsor\'s information, attach the needed parish certificate when required, and mark St. Matthew parishioners for parish office verification.',
    sponsor_form_details_title: 'Form Details',
    sponsor_form_details_subtitle: 'Use the sponsor certificate section unless the sponsor is a verified St. Matthew parishioner in good standing.',
    sponsor_form_student_legend: 'Student',
    sponsor_form_sponsor_legend: 'Sponsor',
    sponsor_form_student_name: 'Student\'s Name',
    sponsor_form_confirmation_name: 'Student\'s Confirmation Name',
    sponsor_form_confirmation_name_help: 'Your choice must be a saint\'s name.',
    sponsor_form_sponsor_name: 'Sponsor\'s Name',
    sponsor_form_sponsor_address: 'Sponsor\'s Address',
    sponsor_form_certificate_guidance_title: 'Certificate Guidance',
    sponsor_form_certificate_guidance_body: 'The sponsor must obtain a Sponsor Certificate issued by their parish showing that they are a practicing member of the Catholic faith, unless they are a St. Matthew parishioner in good standing and are verified by the parish office.',
    sponsor_form_st_matthew_title: 'St. Matthew Sponsor Option',
    sponsor_form_st_matthew_label: 'Sponsor is a St. Matthew parishioner in good standing',
    sponsor_form_st_matthew_help: 'If checked, no Sponsor Certificate is needed, but the parish office must verify this sponsor before final approval.',
    sponsor_form_note_title: 'Please Note',
    sponsor_form_note_body: 'Please note that each candidate must have a qualified sponsor. A Confirmation sponsor is not just a ceremonial role, but a spiritual one: someone who will accompany your child in his or her journey of faith.',
    sponsor_form_requirements_title: 'Requirements for a Confirmation Sponsor',
    sponsor_form_requirement_1: 'Must be a practicing Catholic who has received the Sacraments of Baptism, Eucharist, and Confirmation.',
    sponsor_form_requirement_2: 'Must be at least 16 years of age.',
    sponsor_form_requirement_3: 'Must be living a life in harmony with the teachings of the Catholic Church.',
    sponsor_form_requirement_4: 'If married, must be in a marriage recognized by the Catholic Church.',
    sponsor_form_requirement_5: 'Cannot be the parent of the candidate.',
    sponsor_form_certificate_note: 'In addition, the sponsor must obtain a Letter of Eligibility (Sponsor Certificate) from his or her parish. This letter confirms that the individual meets the requirements to serve as a sponsor. Please ensure this letter is submitted along with the sponsor form.',
    sponsor_form_role_title: 'Role and Responsibilities of a Sponsor',
    sponsor_form_role_1: 'To be a spiritual mentor and guide to your child.',
    sponsor_form_role_2: 'To support your child through prayer and encouragement.',
    sponsor_form_role_3: 'To model an active and faithful Catholic life.',
    sponsor_form_role_4: 'To continue supporting your child even after Confirmation, as they grow in their faith.',
    sponsor_form_closing: 'We encourage you to choose someone who will take this responsibility seriously and be a positive influence in your child\'s spiritual life. If you have any questions or need assistance, please do not hesitate to contact me.',
    sponsor_form_certificate_legend: 'Sponsor Certificate',
    sponsor_form_attach_certificate: 'Attach Scanned Sponsor Certificate',
    sponsor_form_certificate_required_help: 'Required unless the sponsor is a St. Matthew parishioner in good standing.',
    sponsor_form_current_file: 'Current file:',
    sponsor_form_view_certificate: 'View Sponsor Certificate',
    sponsor_form_save: 'Save Form',
    sponsor_form_update: 'Update Form',
    sponsor_form_save_incomplete: 'Save Incomplete',
    sponsor_form_incomplete_saved: 'Sponsor confirmation form saved as incomplete.',
    sponsor_form_submitted_saved: 'Sponsor confirmation form saved.',
    incomplete: 'Incomplete',
    in_progress: 'In Progress',
    conditionally_accepted: 'Conditionally Accepted',
    admitted: 'Admitted',
    completed: 'Completed',
    cancelled: 'Cancelled',
    discontinued: 'Discontinued',
    graduated: 'Graduated',
  },
  es: {
    app_title: 'Iglesia Católica San Mateo',
    reg_title: 'Inscríbete para Formación en la Fe y Preparación Sacramental',
    school_year: 'Año Escolar',
    landing_focus_title: 'Formación en la fe y preparación sacramental',
    landing_focus_subtitle: 'Para niños, candidatos de OCIA y eventos de formación en la fe para adultos',
    secure_online: 'Regístrese o inicie sesión para ver los formularios de inscripción para familias, catequistas, administradores y participantes de formación.',
    create_account: 'Crear Cuenta',
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    open_dashboard: 'Abrir Panel',
    dashboard: 'Panel',
    my_account: 'Mi Cuenta',
    account_profile: 'Perfil de Cuenta',
    account_profile_subtitle: 'Su informacion de inicio de sesion y perfil.',
    profile_information: 'Informacion del Perfil',
    account_security: 'Seguridad de la Cuenta',
    my_uploads: 'Mis Archivos',
    user_uploads: 'Archivos del Usuario',
    uploaded_documents: 'Documentos Subidos',
    uploaded_documents_subtitle: 'Archivos adjuntos a sus inscripciones.',
    no_uploads: 'Todavia no hay archivos subidos asociados con su cuenta.',
    document_type: 'Tipo de Documento',
    registration: 'Inscripcion',
    signed_in_as: 'Conectado como',
    new_registration: 'Nueva Inscripción',
    calendar: 'Calendario',
    manage_users: 'Panel de Administracion',
    manage_visit_availability: 'Administrar Disponibilidad de Visitas',
    submitted_registrations: 'Inscripciones Enviadas',
    student: 'Estudiante',
    grade: 'Grado',
    parent: 'Padre/Madre/Tutor',
    primary_contact: 'Contacto Primario',
    total_fees: 'Total de Cuotas',
    certificates: 'Certificados',
    baptism: 'Bautismo',
    communion: 'Comunión',
    user_administration: 'Administración de Usuarios',
    user_registrations: 'Inscripciones del Usuario',
    view_registrations: 'Ver Inscripciones',
    associated_registrations: 'Inscripciones Asociadas',
    associated_registrations_subtitle: 'Inscripciones conectadas a esta cuenta de usuario.',
    back_to_dashboard: 'Volver al Panel',
    email: 'Correo Electrónico',
    file: 'Archivo',
    phone: 'Telefono',
    account_status: 'Estado de la Cuenta',
    active_status: 'Activa',
    inactive_status: 'Inactiva',
    verified_status: 'Verificada',
    not_verified_status: 'No verificada',
    sign_in_method: 'Metodo de Inicio',
    member_since: 'Miembro Desde',
    role: 'Rol',
    provider: 'Proveedor',
    update_role: 'Actualizar Rol',
    save: 'Guardar',
    create_login: 'Crear Cuenta',
    full_name: 'Nombre Completo',
    first_name: 'Nombre',
    last_name: 'Apellido',
    password: 'Contraseña',
    forgot_password: '¿Olvidaste tu contraseña?',
    forgot_password_intro: 'Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.',
    send_reset_link: 'Enviar Enlace',
    back_to_login: 'Volver al inicio de sesión',
    check_your_email: 'Revisa tu correo electrónico',
    forgot_password_sent_intro: 'Si existe una cuenta con esa dirección, hemos enviado un enlace para restablecer la contraseña a',
    reset_password: 'Restablecer Contraseña',
    new_password: 'Nueva Contraseña',
    confirm_new_password: 'Confirmar Nueva Contraseña',
    password_min_length: 'Debe tener al menos 8 caracteres.',
    change_password: 'Cambiar Contraseña',
    current_password: 'Contraseña Actual',
    update_password: 'Actualizar Contraseña',
    role_request: 'Rol',
    invite_code: 'Código de Invitación (requerido para admin/catequista)',
    already_have_account: '¿Ya tienes una cuenta?',
    continue_free_providers: 'O continúa con proveedores gratuitos:',
    need_account: '¿Necesitas una cuenta?',
    sign_up: 'Regístrate',
    registration_form_title: 'Inscripción para Formación en la Fe — Niños',
    back: 'Volver',
    primary_parent_contact: 'Contacto del Padre/Madre/Tutor',
    primary_contact_phone: 'Teléfono de Contacto',
    primary_contact_email: 'Correo de Contacto',
    relationship: 'Relación con el Niño',
    relationship_other: 'Si elige Otro, describa',
    father: 'Padre',
    mother: 'Madre',
    stepfather: 'Padrastro',
    stepmother: 'Madrastra',
    grandfather: 'Abuelo',
    grandmother: 'Abuela',
    grandparents: 'Abuelos',
    other_lives_with: 'Otro',
    other: 'Otro',
    address: 'Dirección de la Calle',
    city: 'Ciudad',
    state: 'Estado',
    zip: 'Código Postal',
    address_information: 'Información de Dirección',
    city_state_zip: 'Ciudad, Estado y Código Postal',
    home_phone: 'Teléfono de Casa',
    primary_contact_religion: 'Religión del Contacto Primario',
    father_name: 'Nombre del Padre',
    father_religion: 'Religión del Padre',
    father_cell: 'Celular del Padre',
    mother_maiden_name: 'Apellido de Soltera de la Madre',
    mother_religion: 'Religión de la Madre',
    mother_cell: 'Celular de la Madre',
    child_lives_with: 'El Niño Vive Con',
    both: 'Ambos',
    step_parent_name: 'Nombre del Padrastro/Madrastra',
    step_parent_religion: 'Religión del Padrastro/Madrastra',
    student_full_name: 'Nombre Completo del Estudiante',
    student_first_name: 'Nombre del Estudiante',
    student_middle_name: 'Segundo Nombre del Estudiante',
    student_last_name: 'Apellido del Estudiante',
    birth_city: 'Ciudad de Nacimiento',
    birth_country: 'País de Nacimiento',
    gender: 'Género',
    male: 'Masculino',
    female: 'Femenino',
    age: 'Edad',
    dob: 'Fecha de Nacimiento',
    place_of_birth: 'Lugar de Nacimiento del Niño',
    ccd_grade_level: 'Grado CCD (Código de Clase)',
    school_grade_level: 'Grado Escolar',
    school_attending: 'Escuela a la que Asiste',
    baptism_date: 'Fecha de Bautismo',
    baptism_church: 'Iglesia de Bautismo / Ciudad / Estado',
    first_communion_date: 'Fecha de Primera Comunión',
    first_communion_church: 'Iglesia de Primera Comunión / Ciudad / Estado',
    comments: 'Discapacidades / Dificultades de Aprendizaje / Comentarios',
    family_count: 'Cantidad de hijos en la familia (para cuota)',
    parent_signature: 'Firma del Padre / Tutor',
    first_name: 'Nombre',
    last_name: 'Apellido',
    upload_scans: 'Subir Escaneos de Certificados',
    multiple_files_hint: 'Seleccione uno o mas archivos si el certificado tiene varias paginas.',
    add_file: 'Agregar archivo',
    remove_file: 'Quitar archivo',
    baptism_required: 'Certificado de Bautismo (requerido si es el primer año)',
    communion_required: 'Certificado de Primera Comunión (requerido para 3er grado en adelante)',
    fee_notice: 'Cuotas: $150 por un hijo / $200 por familia; cuota sacramental de $25 para segundo grado/SS2, $50 para segundo año de Confirmación.',
    submit_registration: 'Enviar Inscripción',
    cancel: 'Cancelar',
    footer_note: 'Por favor verifique los registros sacramentales antes de enviar. Contacte a la oficina parroquial con preguntas.',
    language: 'Idioma',
    english: 'Inglés',
    spanish: 'Español',
    registration_date_auto: 'Fecha de inscripción (asignada automáticamente por el sistema)',
    register_child: 'Inscribir Niño para Formación en la Fe',
    register_adult: 'Inscribir para Programa de Adultos',
    phone: 'Teléfono',
    // Dashboard
    new_registration_heading: 'Nueva Inscripción',
    childrens_programs: 'Programas para Niños',
    family_programs: 'Programas Familiares',
    adult_programs: 'Programas para Adultos',
    no_children_regs: 'No hay inscripciones de niños todavía.',
    no_family_regs: 'Todavía no hay inscripciones de formación en la fe familiar.',
    no_adult_regs: 'No hay inscripciones de programas para adultos todavía.',
    faith_formation_children: 'Formación en la Fe — Niños',
    family_faith_registrations: 'Inscripciones de Formación en la Fe Familiar',
    adult_program_regs: 'Inscripciones de Programas para Adultos',
    name_col: 'Nombre',
    program_col: 'Programa',
    date_col: 'Fecha',
    members_col: 'Miembros',
    family_name: 'Nombre de la Familia',
    family_primary_contact: 'Contacto Principal',
    family_badges: 'Necesidades Sacramentales',
    family_badges_none: 'No se indicaron necesidades sacramentales.',
    visit: 'Visita',
    visit_window: 'Horario de Visita',
    assigned_leader: 'Líder Asignado',
    // Program cards
    prog_children_title: 'Formación en la Fe para Niños',
    prog_children_subtitle: 'Año de Formacion en la Fe',
    prog_children_desc: 'Inscriba a un niño para clases de catecismo, preparación sacramental (Primera Comunión, Confirmación) y formación en la fe semanal.',
    prog_family_title: 'Formación en la Fe Familiar',
    prog_family_subtitle: 'Inscripción del Hogar Completo',
    prog_family_desc: 'Inscriba a toda una familia y muestre las necesidades sacramentales de cada miembro con distintivos claros para Bautismo, Primera Reconciliación, Primera Comunión y Confirmación.',
    prog_ocia_title: 'OCIA para Adultos',
    prog_ocia_subtitle: 'Orden de Iniciación Cristiana',
    prog_ocia_desc: 'Para adultos que aún no son católicos y desean explorar o entrar a la fe católica a través de los sacramentos de iniciación.',
    prog_baptism_title: 'Preparación para el Bautismo',
    prog_baptism_subtitle: 'Padres y Padrinos',
    prog_baptism_desc: 'Clase de preparación requerida para padres y padrinos de infantes o niños que serán bautizados en San Mateo.',
    prog_confirm_title: 'Confirmación para Adultos',
    prog_confirm_subtitle: 'Completando la Iniciación',
    prog_confirm_desc: 'Para católicos bautizados que aún no han recibido el Sacramento de la Confirmación y desean completar su iniciación.',
    // Adult registration form
    your_information: 'Su Información',
    are_you_baptized: '¿Está bautizado/a?',
    select_placeholder: '— Seleccione —',
    baptized_yes_catholic: 'Sí, católico/a',
    baptized_yes_other: 'Sí, en otra tradición cristiana',
    baptized_no: 'No',
    baptized_unsure: 'No estoy seguro/a',
    baptism_details: 'Detalles del Bautismo',
    name_of_person_baptized: 'Nombre del niño / persona a ser bautizada',
    your_role: 'Su rol',
    role_parent: 'Padre/Madre',
    role_godparent: 'Padrino/Madrina / Patrocinador',
    role_both: 'Padre/Madre y padrino/madrina',
    class_date: 'Fecha de Clase',
    choose_class_date: 'Seleccione la Fecha de la Clase de Preparacion Bautismal',
    no_class_dates_available: 'No hay fechas de clase disponibles actualmente. Por favor contacte a la oficina parroquial.',
    baptism_prep_dates: 'Fechas de Preparacion Bautismal',
    add_class_date: 'Agregar Fecha de Clase',
    configured_class_dates: 'Fechas Configuradas',
    class_time: 'Hora de Clase',
    classroom: 'Salon',
    ccd_classes: 'Eventos de Formacion en la Fe',
    add_ccd_class: 'Agregar Clase',
    configured_ccd_classes: 'Clases Configuradas',
    grade_level: 'Nombre del Evento',
    no_ccd_classes: 'No hay eventos de formacion en la fe configurados todavia.',
    manage_events: 'Administrar Eventos',
    faith_formation_events: 'Eventos de Formacion en la Fe',
    event_definitions: 'Definiciones de Eventos',
    event_schedule: 'Programacion de Eventos',
    schedule_event: 'Programar Evento',
    schedule_type: 'Tipo de Programacion',
    one_time_event: 'Evento Unico',
    recurring_event: 'Evento Recurrente',
    recurrence_pattern: 'Patron de Recurrencia',
    weekday: 'Dia de la Semana',
    add_event: 'Agregar Evento',
    event_title: 'Titulo del Evento',
    event_date: 'Fecha del Evento',
    event_time: 'Hora del Evento',
    event_end_time: 'Hora de Finalizacion',
    event_location: 'Ubicacion',
    audience: 'Audiencia',
    no_events_configured: 'No hay eventos configurados todavia.',
    no_event_definitions: 'No hay definiciones de eventos creadas todavia.',
    children_faith_formation: 'Formacion en la Fe para Ninos',
    general_events: 'Eventos Generales para Todos',
    monthly_calendar: 'Calendario Mensual',
    no_events_this_month: 'No hay eventos programados para este mes.',
    previous_month: 'Mes Anterior',
    next_month: 'Mes Siguiente',
    remove: 'Eliminar',
    spouse_coparent_name: 'Nombre del cónyuge / co-padre',
    if_attending_together: '(si asisten juntos)',
    sacramental_history: 'Historial Sacramental',
    church_where_baptized: 'Iglesia donde fue bautizado/a',
    church_placeholder: 'Nombre de la iglesia, Ciudad, Estado',
    baptism_date_approx: 'Fecha de bautismo',
    approx_ok: '(aproximada está bien)',
    received_first_communion: '¿Ha recibido la Primera Comunión?',
    family_registration_form_title: 'Inscripción para Formación en la Fe Familiar',
    family_household: 'Información del Hogar',
    family_members: 'Miembros de la Familia',
    add_family_member: 'Agregar Miembro de la Familia',
    remove_member: 'Eliminar',
    member_first_name: 'Nombre del Miembro',
    member_last_name: 'Apellido del Miembro',
    member_role: 'Rol en la Familia',
    member_dob: 'Fecha de Nacimiento',
    member_notes: 'Notas del Miembro',
    household_notes: 'Notas del Hogar',
    sacramental_needs: 'Necesidades Sacramentales',
    choose_visit: 'Seleccione una Visita',
    no_visit_slots: 'No hay horarios de Visita disponibles en este momento. Por favor contacte a la oficina parroquial.',
    visit_help: 'Seleccione un horario de Visita de 30 minutos con un líder de formación en la fe familiar.',
    family_faith_leader: 'Líder de Formación en la Fe Familiar',
    leader: 'Líder',
    available_visit_slots: 'Horarios de Visita Disponibles',
    add_visit_slots: 'Agregar Horarios de Visita',
    visit_date: 'Fecha de la Visita',
    start_time: 'Hora de Inicio',
    end_time: 'Hora de Fin',
    your_visit_availability: 'Su Disponibilidad de Visitas',
    configured_visit_slots: 'Horarios de Visita Configurados',
    no_visit_slots_configured: 'Todavía no se han configurado horarios de Visita.',
    slots_created: 'Se crearon los horarios de Visita.',
    visit_slot_removed: 'Se eliminó el horario de Visita.',
    visit_slot_required: 'Seleccione un horario de Visita disponible.',
    first_holy_communion: 'Primera Comunión',
    first_reconciliation: 'Primera Reconciliación',
    confirmation: 'Confirmación',
    role_child_member: 'Hijo(a)',
    role_parent_member: 'Padre/Madre',
    role_guardian_member: 'Tutor',
    role_grandparent_member: 'Abuelo(a)',
    role_other_member: 'Otro',
    yes: 'Sí',
    no: 'No',
    questions_comments: 'Preguntas o Comentarios',
    comments_placeholder: 'Cualquier pregunta, limitación de horario u otra información que desee compartir',
    // Signup
    are_you_staff: '¿Es usted miembro del personal parroquial?',
    i_am_catechist: 'Soy Catequista',
    catechist_desc: 'Maestro/a de formación en la fe o instructor/a voluntario/a',
    i_am_admin: 'Soy Administrador/a del Programa',
    admin_desc: 'Personal parroquial que administra el programa de formación en la fe',
    leave_unchecked: 'Deje ambas casillas sin marcar para registrarse como usuario regular (familias, feligreses).',
    contact_parish_code: 'Contacte a la oficina parroquial si necesita un código de invitación.',
    invite_placeholder: 'Ingrese el código de invitación proporcionado por la oficina parroquial',
    // Registration form
    student_info: 'Información del Estudiante',
    sacramental_records: 'Registros Sacramentales',
    total_fees_due: 'Total de Cuotas Adeudadas',
    pay_registration_fee_online: 'Pagar Cuota de Inscripción en Línea',
    how_many_children_ccd: '¿Cuántos niños está inscribiendo para CCD?',
    phone_format_hint: 'Formato: 123-456-7890 o 123.456.7890 o 123 456 7890',
    invalid_phone_feedback: 'Por favor ingrese un número de teléfono válido (formato XXX-XXX-XXXX).',
    invalid_email_feedback: 'Por favor ingrese una dirección de correo electrónico válida.',
    religion_catholic: 'Católico',
    religion_non_denominational: 'No denominacional',
    religion_protestant: 'Protestante',
    religion_muslim: 'Musulmán',
    religion_hindu: 'Hindú',
    religion_buddhist: 'Budista',
    religion_agnostic: 'Agnóstico',
    religion_atheist: 'Ateo',
    state_AL: 'Alabama', state_AK: 'Alaska', state_AZ: 'Arizona', state_AR: 'Arkansas',
    state_CA: 'California', state_CO: 'Colorado', state_CT: 'Connecticut', state_DE: 'Delaware',
    state_FL: 'Florida', state_GA: 'Georgia', state_HI: 'Hawái', state_ID: 'Idaho',
    state_IL: 'Illinois', state_IN: 'Indiana', state_IA: 'Iowa', state_KS: 'Kansas',
    state_KY: 'Kentucky', state_LA: 'Luisiana', state_ME: 'Maine', state_MD: 'Maryland',
    state_MA: 'Massachusetts', state_MI: 'Míchigan', state_MN: 'Minnesota', state_MS: 'Misisipi',
    state_MO: 'Misuri', state_MT: 'Montana', state_NE: 'Nebraska', state_NV: 'Nevada',
    state_NH: 'Nueva Hampshire', state_NJ: 'Nueva Jersey', state_NM: 'Nuevo México', state_NY: 'Nueva York',
    state_NC: 'Carolina del Norte', state_ND: 'Dakota del Norte', state_OH: 'Ohio', state_OK: 'Oklahoma',
    state_OR: 'Oregón', state_PA: 'Pensilvania', state_RI: 'Rhode Island', state_SC: 'Carolina del Sur',
    state_SD: 'Dakota del Sur', state_TN: 'Tennessee', state_TX: 'Texas', state_UT: 'Utah',
    state_VT: 'Vermont', state_VA: 'Virginia', state_WA: 'Washington', state_WV: 'Virginia Occidental',
    state_WI: 'Wisconsin', state_WY: 'Wyoming',
    continue_to_student_info: 'Continuar a Información del Estudiante',
    not_baptized_checkbox_label: 'Este niño no está bautizado',
    sacramental_preparation_legend: 'Preparación Sacramental',
    registering_child_for: '¿Para qué está inscribiendo a este niño?',
    sacramental_prep_year: 'Año de Preparación Sacramental',
    non_sacramental_year: 'Año No Sacramental',
    which_sacrament: '¿Qué sacramento?',
    holy_communion: 'Sagrada Comunión',
    which_year: '¿Qué año?',
    first_year_of: 'Primer Año de',
    second_year_of: 'Segundo Año de',
    attended_first_year_prefix: 'Este niño ha completado el primer año de',
    preparation_word: 'preparación',
    check_box_above_enable: '(marque la casilla de arriba para habilitar)',
    first_year_info_notice: 'Se invita a los padres a unirse a este camino de preparación sacramental para niños participando en este programa. Estas sesiones serán un poco más largas pero menos frecuentes (aproximadamente 11 reuniones hasta mayo).',
    what_grade_ccd: '¿En qué grado está este niño para CCD?',
    preferred_class_time: 'Horario de Clase Preferido',
    not_yet_scheduled: 'Aún no programado — comuníquese con la oficina parroquial.',
    save_and_continue: 'Guardar y Continuar',
    back_to_previous_student: 'Volver al Estudiante Anterior',
    back_to_parent_info: 'Volver a Información de Padres',
    fee_schedule_label: 'Tabla de Cuotas',
    not_baptized_ask_dob: 'Ingrese la fecha de nacimiento del niño arriba para determinar si aplica el Primer Año de Comunión o el Primer Año de Confirmación.',
    not_baptized_only_option_prefix: 'Como este niño aún no está bautizado, el Primer Año de',
    not_baptized_only_option_suffix: 'es la única opción disponible, según la edad.',
    wizard_parent_info_child1: 'Información de Padres e Hijo 1',
    wizard_child_word: 'Niño',
    wizard_of_word: 'de',
    wizard_step_word: 'Paso',
    name: 'Nombre',
    time: 'Hora',
    room: 'Salón',
    location: 'Ubicación',
    notes: 'Notas',
    child_col: 'Niño',
    contact_col: 'Contacto',
    submitted_col: 'Enviado',
    unassigned: 'Sin asignar',
    select_event: 'Seleccionar evento',
    select_weekday: 'Seleccionar día de la semana',
    select_classroom: 'Seleccionar salón',
    current_badge: 'Actual',
    open_status: 'Abierto',
    closed_status: 'Cerrado',
    tab_users: 'Usuarios',
    tab_settings: 'Configuración',
    tab_event_scheduler: 'Programador de Eventos',
    tab_eucharistic_adoration: 'Adoración Eucarística',
    filter_by_user_type: 'Filtrar por tipo de usuario',
    all_users: 'Todos los Usuarios',
    role_user: 'Usuario',
    role_catechist: 'Catequista',
    role_admin: 'Administrador',
    user_singular: 'usuario',
    user_plural: 'usuarios',
    search_users_placeholder: 'Buscar por nombre o correo',
    filter_by_status: 'Filtrar por estado',
    all_statuses: 'Todos los estados',
    change_role: 'Cambiar rol',
    more_actions: 'Más acciones',
    previous_page: 'Anterior',
    next_page: 'Siguiente',
    page_x_of_y: 'Página {page} de {total}',
    invite_catechist_header: 'Invitar a un Catequista',
    invite_catechist_desc: 'Crea una cuenta de Catequista y envía un enlace de activación para que puedan establecer su propia contraseña.',
    invite_full_name_label: 'Nombre Completo',
    invite_email_label: 'Correo Electrónico',
    invite_phone_label: 'Teléfono (opcional)',
    invite_catechist_submit: 'Enviar Invitación',
    create_user_header: 'Crear un Usuario',
    create_user_desc: 'Crea una cuenta con una contraseña temporal. Podrán iniciar sesión de inmediato y se les pedirá establecer una nueva contraseña en el primer inicio de sesión.',
    create_user_role_label: 'Rol',
    create_user_submit: 'Crear Usuario',
    verified_status: 'Verificado',
    pending_status: 'Pendiente',
    confirmed_status: 'Confirmado',
    preview_email: 'Vista Previa del Correo',
    resend: 'Reenviar',
    reset_password_btn: 'Restablecer Contraseña',
    deleted_status: 'Eliminada',
    mark_deleted_user: 'Marcar Eliminada',
    restore_user: 'Restaurar Cuenta',
    confirm_remove_user: '¿Marcar esta cuenta de usuario como eliminada? Las inscripciones y registros existentes permanecerán.',
    faith_formation_registration_header: 'Inscripción de Formación en la Fe',
    current_registration_year: 'Año de Inscripción Actual',
    set_current_registration_year: 'Establecer Año de Inscripción Actual',
    current_registration_year_label: 'Año de inscripción actual:',
    registration_year_toggle_notice: 'La apertura y cierre se controla por año a continuación, para que pueda mantener 2025-2026 abierto mientras 2026-2027 permanece cerrado.',
    registration_availability_by_year: 'Disponibilidad de Inscripción por Año',
    school_year_col: 'Año Escolar',
    faith_formation_col: 'Formación en la Fe',
    sponsor_form_col: 'Formulario de Padrino',
    catechist_assignments_header: 'Asignaciones de Catequistas',
    preferred_class_time_notice: 'Estas clases determinan el "Horario de Clase Preferido" que se muestra a los padres durante la inscripción de preparación sacramental — el grado 1–9 tiene un significado fijo (abajo) para que ambos se mantengan sincronizados.',
    class_time_label: 'Horario de Clase',
    class_time_placeholder: 'ej. Lunes 4:00-5:15 PM',
    room_placeholder: 'ej. Salón 101',
    add_class: 'Agregar Clase',
    no_ccd_classes: 'Aún no se han configurado clases de CCD.',
    class_col: 'Clase',
    assigned_catechist_col: 'Catequista Asignado',
    confirm_remove_class: '¿Eliminar esta clase? Ya no aparecerá como opción de horario preferido.',
    altar_training_dates_header: 'Fechas de Entrenamiento de Monaguillos',
    training_date_label: 'Fecha de Entrenamiento',
    location_placeholder_parish_center: 'ej. Centro Parroquial',
    notes_placeholder_optional: 'Detalles opcionales',
    add_training_date: 'Agregar Fecha de Entrenamiento',
    no_altar_training_dates: 'Aún no se han programado fechas de entrenamiento de monaguillos.',
    date_time_col: 'Fecha y Hora',
    confirm_remove_training_date: '¿Eliminar esta fecha de entrenamiento?',
    altar_signups_header: 'Inscripciones de Monaguillos',
    no_altar_signups: 'Aún no hay inscripciones de monaguillos.',
    parent_guardian_col: 'Padre / Tutor',
    preferred_training_col: 'Entrenamiento Preferido',
    dob_prefix: 'Fecha de Nac.:',
    no_preference: 'Sin preferencia',
    confirm_remove_altar_signup: '¿Eliminar esta inscripción de monaguillo?',
    adoration_calendar_header: 'Calendario de Adoración Eucarística',
    available_date_label: 'Fecha Disponible',
    start_time_label: 'Hora de Inicio',
    end_time_label: 'Hora de Fin',
    add_available_date: 'Agregar Fecha Disponible',
    no_adoration_dates: 'Aún no se han configurado fechas de Adoración Eucarística.',
    time_window_col: 'Horario',
    signups_col: 'Inscripciones',
    confirm_remove_adoration_date: '¿Eliminar esta fecha disponible de adoración? Los registros de inscripción existentes para ese día permanecerán para su revisión.',
    adoration_signups_header: 'Inscripciones de Adoración Eucarística',
    no_adoration_signups: 'Aún no hay inscripciones de Adoración Eucarística.',
    time_slot_col: 'Horario',
    confirm_remove_adoration_signup: '¿Eliminar esta inscripción de adoración y reabrir el horario?',
    registrations_title: 'Inscripciones',
    all_registrations_header: 'Todas las Inscripciones',
    all_registrations_subtitle: 'Cada inscripción de familia, niño, adulto y confirmación de padrino en toda la parroquia.',
    export_registrations_csv: 'Exportar CSV',
    filter_by_grade: 'Filtrar por grado',
    all_grades: 'Todos los Grados',
    no_grade_match: 'No hay inscripciones que coincidan con este grado.',
    filter_by_parent: 'Filtrar por padre/madre',
    parent_filter_placeholder: 'Nombre o correo del padre/madre',
    apply_filters: 'Aplicar filtros',
    clear_filters: 'Borrar filtros',
    no_registrations_match_filters: 'No hay inscripciones que coincidan con estos filtros.',
    archive: 'Archivar',
    confirm_delete_registration_prefix: 'Eliminar permanentemente la inscripción de',
    confirm_delete_registration_suffix: 'Esto no se puede deshacer.',
    archived_children_registrations_header: 'Inscripciones de Niños Archivadas',
    archived_adult_registrations_header: 'Inscripciones de Adultos Archivadas',
    no_archived_registrations: 'No hay inscripciones archivadas.',
    archived_col: 'Archivado',
    unarchive: 'Desarchivar',
    sponsor_confirmation_forms_header: 'Formularios de Confirmación de Padrino',
    sponsor_form_certificate_upload: 'Certificado del Padrino',
    no_sponsor_forms: 'Aún no hay formularios de confirmación de padrino.',
    confirmation_name_col: 'Nombre de Confirmación',
    sponsor_col: 'Padrino',
    certificate_col: 'Certificado',
    verification_col: 'Verificación',
    st_matthew_parishioner: 'Feligrés de St. Matthew',
    view_file: 'Ver Archivo',
    view_files_count: 'Ver archivos (%s)',
    certificate_files: 'Archivos de Certificado',
    close: 'Cerrar',
    admin_verified: 'Verificado por el administrador',
    pending_admin_review: 'Pendiente de revisión administrativa',
    certificate_provided: 'Certificado proporcionado',
    missing_certificate: 'Certificado faltante',
    verify: 'Verificar',
    certificates_verified_label: 'Certificados verificados',
    tuition_paid_label: 'Matrícula pagada',
    parent_contacted_label: 'Padre contactado',
    child_verification_col_header: 'Verificación',
    verified_by_on: 'por %s el %s',
    confirm_delete_sponsor_form: '¿Eliminar este formulario de confirmación de padrino? Esto es útil para eliminar entradas de prueba.',
    total_fees_due_all_active: 'Total de Cuotas Adeudadas — todas las inscripciones activas',
    registration_fee_col: 'Inscripción',
    sacramental_fee_col: 'Sacramental',
    late_fee_col: 'Recargo',
    subtotal_col: 'Subtotal',
    already_have_prefix: 'Ya tiene',
    registration_singular: 'una inscripción',
    registrations_word: 'inscripciones',
    on_file_for_suffix: 'registrada(s) para:',
    check_my_registrations_prefix: 'Consulte',
    my_registrations_tab: 'Mis Inscripciones',
    check_my_registrations_suffix: 'a continuación antes de comenzar una nueva para evitar registrar al mismo niño dos veces.',
    view_my_registrations: 'Ver Mis Inscripciones',
    admin_area: 'Área de Administración',
    program_registrations_tab: 'Inscripciones de Programas',
    sponsor_ministry_signups_tab: 'Inscripciones de Padrinos y Ministerios',
    registration_closed_notice: 'La inscripción está actualmente cerrada. Comuníquese con la oficina parroquial o espere a que un administrador abra este año.',
    confirmation_sponsor_form_title: 'Formulario de Padrino de Confirmación',
    student_sponsor_subtitle: 'Estudiante / Padrino',
    sponsor_form_desc: 'Ingrese y guarde la información de confirmación del padrino, incluyendo dirección y firmas.',
    sponsor_form_unavailable: 'No disponible hasta que un administrador abra el Formulario de Padrino.',
    altar_server_signup_title: 'Inscripción de Monaguillo',
    ministry_subtitle: 'Ministerio',
    altar_server_signup_desc: 'Inscriba a su hijo para servir en el altar en la Iglesia Católica Saint Matthew. Se proporciona entrenamiento.',
    required_field: 'Este campo es obligatorio.',
    classes_nav: 'Clases',
    classes_header: 'Clases',
    classes_subtitle: 'Listas de estudiantes, contactos de los padres y el horario de cada clase de formación en la fe.',
    no_classes_configured_yet: 'Aún no se han configurado clases.',
    student_count_singular: 'estudiante',
    student_count_plural: 'estudiantes',
    next_label: 'Próxima',
    back_to_classes: 'Volver a Clases',
    roster_label: 'Lista de Estudiantes',
    class_teacher_label: 'Catequista',
    schedule_label: 'Horario',
    attendance_label: 'Asistencia',
    present_label: 'Presente',
    absent_label: 'Ausente',
    unmarked_label: 'sin marcar',
    no_students_in_class: 'Aún no hay estudiantes en esta clase.',
    pending_acceptance_label: 'Pendiente',
    pending_count_label: 'pendiente(s)',
    section_col: 'Sección',
    section_label_placeholder: 'ej. A',
    my_classes_nav: 'Mis Clases',
    catechists_more_suffix: 'más',
    show_all_label: 'Mostrar todos',
    show_less_label: 'Mostrar menos',
    send_message_label: 'Enviar un Mensaje',
    select_all_label: 'Seleccionar todos',
    select_none_label: 'Deseleccionar todos',
    selected_suffix_label: 'seleccionados',
    subject_label: 'Asunto (opcional)',
    subject_placeholder: 'ej. Recordatorio para este domingo',
    message_label: 'Mensaje',
    message_placeholder: 'Escriba su mensaje para los padres aquí...',
    send_message_button: 'Enviar Mensaje',
    register_family: 'Inscribir Familia para Formación en la Fe',
    // Index accordion
    family_centered_title: 'Una Visión Centrada en la Familia',
    family_centered_body: 'La fe se aprende y se vive mejor dentro de la familia. En lugar de ver la educación religiosa solo como una experiencia en el aula, la Parroquia San Mateo apoya a las familias proporcionando oportunidades de formación tanto para padres como para hijos, recursos para practicar y hablar de la fe en casa, y reuniones parroquiales que fomentan la oración, el aprendizaje y la comunidad.',
    family_centered_note: 'Este enfoque refleja la enseñanza de la Iglesia de que la familia es la "iglesia doméstica", donde la fe se experimenta y se comparte por primera vez.',
    parish_family_title: 'La Parroquia y la Familia Trabajando Juntas',
    parish_family_body: 'La formación en la fe en la Parroquia San Mateo es una asociación entre la comunidad parroquial y la familia. Las familias participan en reuniones periódicas de catequesis familiar, programas de preparación sacramental, oportunidades de oración, comunión y servicio, y actividades centradas en la fe que fortalecen la familia y los lazos comunitarios.',
    sacramental_prep_title: 'Preparación Sacramental',
    sacramental_prep_body: 'La preparación para los Sacramentos—especialmente la Primera Reconciliación, la Primera Comunión y la Confirmación—es una parte importante de nuestro proceso de formación en la fe. Los padres participan activamente a través de retiros, sesiones parroquiales y formación en el hogar.',
    missionary_title: 'Creciendo como Discípulos Misioneros',
    missionary_body: 'A través de la oración, la catequesis, la vida comunitaria y el servicio, nos esforzamos por ayudar a nuestra comunidad parroquial a desarrollar una relación personal con Jesucristo, crecer en el amor por las Sagradas Escrituras y los Sacramentos, experimentar el apoyo de la comunidad parroquial y vivir el Evangelio a través del servicio y el testimonio.',
    about_heading: 'Formación en la Fe en la Parroquia San Mateo',
    about_intro: 'En la Iglesia Católica San Mateo, la formación en la fe es más que un programa—es un viaje de crecimiento como discípulos de Jesucristo. Nuestra parroquia busca ayudar a los niños, padres y familias a profundizar su relación con Cristo y vivir su fe católica en la vida cotidiana.',
    about_intro2: 'Inspirada en la visión de los Ministerios Católicos de Formación en la Fe Familiar, la Parroquia San Mateo adopta un enfoque centrado en la familia para la formación en la fe, reconociendo a los padres como los primeros y más importantes maestros de la fe.',
    // Admin
    manage_roles_desc: 'Administrar roles y acceso para todos los usuarios registrados',
    scan_legacy_form: 'Escanear formulario anterior',
    scan_legacy_desc: 'Use la cámara del teléfono para capturar un formulario en papel y rellenar un borrador.',
    open_scanner: 'Abrir escáner',
    camera_capture: 'Captura de cámara',
    extract_text: 'Extraer texto',
    processing_scan: 'Procesando escaneo con Google Document AI...',
    scan_google_ready: 'Google Document AI',
    document_ai_health: 'Estado de Document AI',
    document_ai_failed: 'No se pudo procesar el documento escaneado.',
    ocr_text: 'Texto escaneado',
    review_imported_fields: 'Revisar campos importados',
    open_registration_draft: 'Abrir borrador de registro',
    imported_draft_ready: 'Borrador importado guardado. Revise y envíe el formulario de registro.',
    // Status
    status: 'Estado',
    current_status: 'Estado actual',
    update_status: 'Actualizar estado',
    status_updated: 'Estado de registro actualizado.',
    save_draft: 'Guardar Borrador',
    actions: 'Acciones',
    edit: 'Editar',
    sponsor_form_title_2026: 'Formulario de Información del Padrino de Confirmación 2026',
    sponsor_form_kicker: 'Preparación para la Confirmación',
    sponsor_form_intro: 'Complete este paso con claridad y reverencia. Registre la información del padrino, adjunte la carta parroquial requerida cuando corresponda, y marque a los feligreses de San Mateo para verificación por la oficina parroquial.',
    sponsor_form_details_title: 'Detalles del Formulario',
    sponsor_form_details_subtitle: 'Use la sección del certificado del padrino a menos que el padrino sea un feligrés verificado de San Mateo en buena posición.',
    sponsor_form_student_legend: 'Estudiante',
    sponsor_form_sponsor_legend: 'Padrino / Madrina',
    sponsor_form_student_name: 'Nombre del Estudiante',
    sponsor_form_confirmation_name: 'Nombre de Confirmación del Estudiante',
    sponsor_form_confirmation_name_help: 'Su elección debe ser el nombre de un santo.',
    sponsor_form_sponsor_name: 'Nombre del Padrino / Madrina',
    sponsor_form_sponsor_address: 'Dirección del Padrino / Madrina',
    sponsor_form_certificate_guidance_title: 'Guía del Certificado',
    sponsor_form_certificate_guidance_body: 'El padrino debe obtener un Certificado de Padrino emitido por su parroquia que demuestre que es un miembro practicante de la fe católica, a menos que sea un feligrés de San Mateo en buena posición y sea verificado por la oficina parroquial.',
    sponsor_form_st_matthew_title: 'Opción para Padrino de San Mateo',
    sponsor_form_st_matthew_label: 'El padrino es un feligrés de San Mateo en buena posición',
    sponsor_form_st_matthew_help: 'Si marca esta opción, no se necesita Certificado de Padrino, pero la oficina parroquial debe verificar al padrino antes de la aprobación final.',
    sponsor_form_note_title: 'Tenga en Cuenta',
    sponsor_form_note_body: 'Tenga en cuenta que cada candidato debe tener un padrino calificado. Un padrino de Confirmación no es solo un papel ceremonial, sino también espiritual: alguien que acompañará a su hijo o hija en su camino de fe.',
    sponsor_form_requirements_title: 'Requisitos para un Padrino de Confirmación',
    sponsor_form_requirement_1: 'Debe ser un católico practicante que haya recibido los sacramentos del Bautismo, la Eucaristía y la Confirmación.',
    sponsor_form_requirement_2: 'Debe tener al menos 16 años de edad.',
    sponsor_form_requirement_3: 'Debe vivir una vida en armonía con las enseñanzas de la Iglesia Católica.',
    sponsor_form_requirement_4: 'Si está casado, debe estar en un matrimonio reconocido por la Iglesia Católica.',
    sponsor_form_requirement_5: 'No puede ser el padre o la madre del candidato.',
    sponsor_form_certificate_note: 'Además, el padrino debe obtener una Carta de Elegibilidad (Certificado de Padrino) de su parroquia. Esta carta confirma que la persona cumple con los requisitos para servir como padrino. Por favor asegúrese de entregar esta carta junto con el formulario del padrino.',
    sponsor_form_role_title: 'Función y Responsabilidades de un Padrino',
    sponsor_form_role_1: 'Ser un mentor y guía espiritual para su hijo o hija.',
    sponsor_form_role_2: 'Apoyar a su hijo o hija con oración y aliento.',
    sponsor_form_role_3: 'Modelar una vida católica activa y fiel.',
    sponsor_form_role_4: 'Seguir apoyando a su hijo o hija después de la Confirmación, mientras crece en la fe.',
    sponsor_form_closing: 'Le animamos a elegir a alguien que tome esta responsabilidad en serio y sea una influencia positiva en la vida espiritual de su hijo o hija. Si tiene alguna pregunta o necesita ayuda, no dude en comunicarse conmigo.',
    sponsor_form_certificate_legend: 'Certificado del Padrino',
    sponsor_form_attach_certificate: 'Adjuntar Certificado del Padrino Escaneado',
    sponsor_form_certificate_required_help: 'Requerido a menos que el padrino sea un feligrés de San Mateo en buena posición.',
    sponsor_form_current_file: 'Archivo actual:',
    sponsor_form_view_certificate: 'Ver Certificado del Padrino',
    sponsor_form_save: 'Guardar Formulario',
    sponsor_form_update: 'Actualizar Formulario',
    sponsor_form_save_incomplete: 'Guardar Incompleto',
    sponsor_form_incomplete_saved: 'El formulario del padrino de confirmación se guardó como incompleto.',
    sponsor_form_submitted_saved: 'El formulario del padrino de confirmación se guardó.',
    incomplete: 'Incompleto',
    in_progress: 'En progreso',
    conditionally_accepted: 'Aceptado Condicionalmente',
    admitted: 'Admitido',
    completed: 'Completado',
    cancelled: 'Cancelado',
    discontinued: 'Discontinuado',
    graduated: 'Graduado',
  }
};
// ── Adult program metadata (locale-aware) ───────────────────
const humanizeTranslationKey = (key) => `${key || ''}`
  .replace(/_/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^./, (letter) => letter.toUpperCase());

const getAdultPrograms = (t) => ({
  ocia: {
    key: 'ocia',
    title: t('prog_ocia_title'),
    subtitle: t('prog_ocia_subtitle'),
    description: t('prog_ocia_desc'),
    icon: '✦',
    color: 'var(--navy)',
  },
  baptism_prep: {
    key: 'baptism_prep',
    title: t('prog_baptism_title'),
    subtitle: t('prog_baptism_subtitle'),
    description: t('prog_baptism_desc'),
    icon: '💧',
    color: 'var(--blue-sky)',
  },
  adult_confirmation: {
    key: 'adult_confirmation',
    title: t('prog_confirm_title'),
    subtitle: t('prog_confirm_subtitle'),
    description: t('prog_confirm_desc'),
    icon: '◆',
    color: 'var(--gold)',
  },
});

const FAMILY_MEMBER_ROLE_OPTIONS = ['child', 'parent', 'guardian', 'grandparent', 'other'];
const SACRAMENT_BADGE_OPTIONS = ['baptism', 'first_reconciliation', 'first_holy_communion', 'confirmation'];

const getAudienceLabelKey = (audience) => {
  if (audience === 'children') return 'children_faith_formation';
  if (audience === 'family_faith') return 'prog_family_title';
  if (audience === 'baptism_prep') return 'prog_baptism_title';
  if (audience === 'ocia') return 'prog_ocia_title';
  return 'general_events';
};

const safeJsonParse = (value, fallback) => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const normalizeFamilyMembers = (value) => {
  const rawMembers = Array.isArray(value) ? value : [];
  return rawMembers
    .map((member) => {
      const firstName = typeof member?.firstName === 'string' ? member.firstName.trim() : '';
      const lastName = typeof member?.lastName === 'string' ? member.lastName.trim() : '';
      const role = typeof member?.role === 'string' && FAMILY_MEMBER_ROLE_OPTIONS.includes(member.role.trim())
        ? member.role.trim()
        : 'child';
      const dob = typeof member?.dob === 'string' ? member.dob.trim() : '';
      const notes = typeof member?.notes === 'string' ? member.notes.trim() : '';
      const sacramentNeeds = Array.from(new Set(
        (Array.isArray(member?.sacramentNeeds) ? member.sacramentNeeds : [])
          .map((item) => `${item}`.trim())
          .filter((item) => SACRAMENT_BADGE_OPTIONS.includes(item))
      ));

      if (!firstName && !lastName && !dob && !notes && !sacramentNeeds.length) {
        return null;
      }

      return {
        firstName,
        lastName,
        role,
        dob,
        notes,
        sacramentNeeds,
      };
    })
    .filter(Boolean);
};

const parseFamilyMembersFromRequest = (value) => normalizeFamilyMembers(safeJsonParse(value, []));
const parseFamilyMembersFromStorage = (value) => normalizeFamilyMembers(safeJsonParse(value, []));

const CCD_GRADE_MEANINGS = {
  '1': 'First Year Holy Communion',
  '2': 'Second Year Holy Communion',
  '3': 'Grade 3',
  '4': 'Grade 4',
  '5': 'Grade 5',
  '6': 'Grade 6',
  '7': 'Grade 7',
  '8': 'First Year Confirmation',
  '9': 'Second Year Confirmation',
};

const CCD_GRADE_BY_SACRAMENTAL_YEAR = {
  first_year_communion: '1',
  second_year_communion: '2',
  first_year_confirmation: '8',
  second_year_confirmation: '9',
};

// The wizard never populates the legacy ccd_grade_level (admin-only) field —
// derive the real CCD grade from what parents actually submit instead.
const resolveCcdGrade = (reg) => {
  if (reg.non_sacramental_grade) return reg.non_sacramental_grade;
  if (reg.sacramental_year && CCD_GRADE_BY_SACRAMENTAL_YEAR[reg.sacramental_year]) {
    return CCD_GRADE_BY_SACRAMENTAL_YEAR[reg.sacramental_year];
  }
  return reg.ccd_grade_level || null;
};

const CLASS_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const parseClassWeekday = (classTimeText) => {
  if (!classTimeText) return null;
  const match = String(classTimeText).trim().match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i);
  if (!match) return null;
  const index = CLASS_WEEKDAY_NAMES.findIndex((day) => day.toLowerCase() === match[1].toLowerCase());
  return index === -1 ? null : index;
};

// When a grade has more than one time-slot section (e.g. three Second Year Communion
// sections), admins assign each a "A"/"B"/"C" section_label directly (see
// POST /admin/ccd-classes/:id/section-label) so they can refer to "2A" instead of an
// ambiguous repeated grade number. Stored, not computed, so it stays put once set.
const getCcdClasses = async () => {
  const ccdClasses = await db.prepare(`
    SELECT classes.id, classes.grade_level, classes.class_time, classes.classroom,
           classes.section_label AS sectionLabel
    FROM ccd_classes classes
    ORDER BY classes.grade_level ASC
  `).all();

  const catechistLinks = await db.prepare(`
    SELECT cc.ccd_class_id, u.id AS catechist_id, u.full_name AS catechist_name,
           u.email AS catechist_email, u.phone AS catechist_phone
    FROM ccd_class_catechists cc
    JOIN users u ON u.id = cc.catechist_user_id
    ORDER BY COALESCE(NULLIF(u.full_name, ''), u.email) ASC
  `).all();

  const catechistsByClass = {};
  catechistLinks.forEach((row) => {
    (catechistsByClass[row.ccd_class_id] || (catechistsByClass[row.ccd_class_id] = [])).push({
      id: row.catechist_id,
      name: row.catechist_name,
      email: row.catechist_email,
      phone: row.catechist_phone,
    });
  });

  return ccdClasses.map((ccdClass) => ({ ...ccdClass, catechists: catechistsByClass[ccdClass.id] || [] }));
};

const SACRAMENTAL_GRADE_LEVELS = new Set(Object.values(CCD_GRADE_BY_SACRAMENTAL_YEAR));

const getClassSlotValue = (ccdClass) =>
  ccdClass.classroom ? `${ccdClass.class_time} — ${ccdClass.classroom}` : ccdClass.class_time;

// Sacramental grades (1, 2, 8, 9) can have multiple time-slot sections per grade, so a
// student's stored preferred_class_time disambiguates which section they belong to.
// Non-sacramental grades (3-7) only ever capture the grade on the registration form, so
// every student in that grade is treated as belonging to that grade's one section.
// Match on class_time alone (not the room-qualified slot value): a class's classroom can
// be assigned/reassigned after a student already registered, so their stored
// preferred_class_time may only have the time portion even though the class now has a room.
const getClassRoster = (ccdClass, allStudentRegs) =>
  allStudentRegs.filter((reg) => {
    if (resolveCcdGrade(reg) !== ccdClass.grade_level) return false;
    if (!SACRAMENTAL_GRADE_LEVELS.has(ccdClass.grade_level)) return true;
    return reg.preferred_class_time === ccdClass.class_time || reg.preferred_class_time === getClassSlotValue(ccdClass);
  });

const getUpcomingSessionDates = (classTimeText, count = 6) => {
  const weekday = parseClassWeekday(classTimeText);
  if (weekday === null) return [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + ((weekday - cursor.getDay() + 7) % 7));
  const dates = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return dates;
};

const formatSessionDateValue = (date) => date.toISOString().slice(0, 10);

// A student shows as a full roster member only once their registration has cleared the
// acceptance gate (conditionally_accepted or later); anything earlier — in_progress,
// incomplete, or otherwise — is still pending and shown as such in the class roster.
const CLASS_ROSTER_ACCEPTED_STATUSES = new Set(['conditionally_accepted', 'admitted', 'completed', 'graduated']);
const isPendingAcceptance = (reg) => !CLASS_ROSTER_ACCEPTED_STATUSES.has(reg.status);
const getCatechists = async () =>
  db.prepare(`
    SELECT id, full_name, email
    FROM users
    WHERE role = 'catechist' AND COALESCE(account_status, 'active') <> 'deleted'
    ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC
  `).all();
const getFamilyFaithLeaders = async () =>
  db.prepare(`
    SELECT id, full_name, email
    FROM users
    WHERE role = 'family_faith_leader' AND COALESCE(account_status, 'active') <> 'deleted'
    ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC
  `).all();
const getFaithFormationEventDefinitions = async () =>
  db.prepare('SELECT id, title, audience FROM faith_formation_event_definitions ORDER BY title ASC').all();
const getAllScheduledFaithFormationEvents = async () =>
  db.prepare(
    `SELECT schedules.id, definitions.title, definitions.audience, schedules.schedule_type, schedules.recurrence_pattern,
            schedules.event_date, schedules.event_time, schedules.event_end_time, schedules.location
     FROM faith_formation_event_schedules schedules
     INNER JOIN faith_formation_event_definitions definitions
       ON definitions.id = schedules.event_definition_id
     ORDER BY schedules.event_date ASC, schedules.event_time ASC, definitions.title ASC`
  ).all();
const getFaithFormationEvents = async (audiences = [], { includePast = false } = {}) => {
  const audienceList = Array.from(new Set((Array.isArray(audiences) ? audiences : [audiences]).filter(Boolean)));
  if (!audienceList.length) return [];
  const placeholders = audienceList.map(() => '?').join(', ');
  const futureOnlyClause = includePast ? '' : `AND (schedules.schedule_type = 'recurring' OR schedules.event_date IS NULL OR schedules.event_date >= ?)`;
  return db.prepare(
    `SELECT schedules.id, definitions.title, definitions.audience, schedules.schedule_type, schedules.recurrence_pattern, schedules.event_date, schedules.event_time, schedules.event_end_time, schedules.location
     FROM faith_formation_event_schedules schedules
     INNER JOIN faith_formation_event_definitions definitions
       ON definitions.id = schedules.event_definition_id
     WHERE definitions.audience IN (${placeholders})
       ${futureOnlyClause}
     ORDER BY event_date ASC, event_time ASC, title ASC`
  ).all(...audienceList, ...(includePast ? [] : [getTodayDateValue()]));
};
const getBaptismPrepSchedules = async () => getFaithFormationEvents(['baptism_prep']);
const getFamilyFaithVisitSlots = async ({ leaderUserId = null, includeBookedRegistrationId = null } = {}) => {
  const conditions = [];
  const params = [];
  if (leaderUserId) {
    conditions.push('slots.leader_user_id = ?');
    params.push(leaderUserId);
  }
  if (includeBookedRegistrationId) {
    conditions.push('(slots.booked_registration_id IS NULL OR slots.booked_registration_id = ?)');
    params.push(includeBookedRegistrationId);
  } else {
    conditions.push('slots.booked_registration_id IS NULL');
  }

  return db.prepare(`
    SELECT slots.id, slots.leader_user_id, slots.slot_start, slots.slot_end, slots.booked_registration_id,
           users.full_name AS leader_name, users.email AS leader_email
    FROM family_faith_visit_slots slots
    INNER JOIN users ON users.id = slots.leader_user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY slots.slot_start ASC
  `).all(...params);
};
const getManagedFamilyFaithVisitSlots = async ({ leaderUserId = null } = {}) => {
  const conditions = [];
  const params = [];
  if (leaderUserId) {
    conditions.push('slots.leader_user_id = ?');
    params.push(leaderUserId);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT slots.id, slots.leader_user_id, slots.slot_start, slots.slot_end, slots.booked_registration_id,
           users.full_name AS leader_name, users.email AS leader_email,
           regs.family_name, regs.primary_contact_name
    FROM family_faith_visit_slots slots
    INNER JOIN users ON users.id = slots.leader_user_id
    LEFT JOIN family_faith_registrations regs ON regs.id = slots.booked_registration_id
    ${whereClause}
    ORDER BY slots.slot_start ASC
  `).all(...params);
};
const formatScheduledEventLabel = (eventItem) => {
  const parts = [eventItem.title];
  if (eventItem.schedule_type === 'recurring' && eventItem.recurrence_pattern) {
    parts.push(eventItem.recurrence_pattern);
  } else if (eventItem.event_date) {
    parts.push(eventItem.event_date);
  }
  if (eventItem.event_time) {
    parts.push(eventItem.event_end_time ? `${eventItem.event_time} - ${eventItem.event_end_time}` : eventItem.event_time);
  }
  if (eventItem.location) {
    parts.push(eventItem.location);
  }
  return parts.join(' · ');
};

const formatVisitSlotLabel = (slot) => {
  const start = new Date(slot.slot_start);
  const end = new Date(slot.slot_end);
  const dateLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeLabel = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return `${dateLabel} · ${timeLabel} · ${slot.leader_name || slot.leader_email}`;
};

const buildThirtyMinuteVisitSlots = (visitDate, startTime, endTime) => {
  const startsAt = new Date(`${visitDate}T${startTime}:00`);
  const endsAt = new Date(`${visitDate}T${endTime}:00`);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt <= startsAt ||
    startsAt.getMinutes() % 30 !== 0 ||
    endsAt.getMinutes() % 30 !== 0
  ) {
    return [];
  }

  const slots = [];
  const cursor = new Date(startsAt);
  while (cursor < endsAt) {
    const next = new Date(cursor.getTime() + 30 * 60 * 1000);
    if (next > endsAt) break;
    slots.push({ slotStart: new Date(cursor), slotEnd: next });
    cursor.setTime(next.getTime());
  }
  return slots;
};
const toSqlDateTime = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const expandScheduledEventsForMonth = (scheduledEvents, year, monthIndex) => {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const occurrences = [];

  scheduledEvents.forEach((eventItem) => {
    if (eventItem.schedule_type === 'recurring') {
      const weekdayIndex = WEEKDAY_INDEX[eventItem.recurrence_pattern];
      if (weekdayIndex == null) return;
      for (let day = 1; day <= daysInMonth; day += 1) {
        const currentDate = new Date(year, monthIndex, day);
        if (currentDate.getDay() !== weekdayIndex) continue;
        const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        occurrences.push({ ...eventItem, occurrence_date: dateKey });
      }
      return;
    }

    if (!eventItem.event_date) return;
    const eventDate = new Date(`${eventItem.event_date}T00:00:00`);
    if (eventDate.getFullYear() !== year || eventDate.getMonth() !== monthIndex) return;
    occurrences.push({ ...eventItem, occurrence_date: eventItem.event_date });
  });

  return occurrences.sort((a, b) => {
    if (a.occurrence_date !== b.occurrence_date) return a.occurrence_date.localeCompare(b.occurrence_date);
    if ((a.event_time || '') !== (b.event_time || '')) return (a.event_time || '').localeCompare(b.event_time || '');
    return a.title.localeCompare(b.title);
  });
};

const buildCalendarWeeks = (occurrences, year, monthIndex) => {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const byDate = occurrences.reduce((acc, eventItem) => {
    const key = eventItem.occurrence_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(eventItem);
    return acc;
  }, {});

  const cells = [];
  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ dayNumber: null, dateKey: null, events: [] });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ dayNumber: day, dateKey, events: byDate[dateKey] || [] });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ dayNumber: null, dateKey: null, events: [] });
  }

  const weeks = [];
  for (let idx = 0; idx < cells.length; idx += 7) {
    weeks.push(cells.slice(idx, idx + 7));
  }
  return weeks;
};

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });

const getPublicUploadPath = (file) => (file?.filename ? path.posix.join('uploads', file.filename) : null);
const getPublicUploadPaths = (files) => (Array.isArray(files) ? files.map(getPublicUploadPath).filter(Boolean) : []);
const parseUploadPaths = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => `${item || ''}`.trim()).filter(Boolean);

  const raw = `${value}`.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => `${item || ''}`.trim()).filter(Boolean);
    }
  } catch (_error) {
    // Older registrations stored a single upload path in this field.
  }

  return [raw];
};
const serializeUploadPaths = (paths) => {
  const cleanPaths = [...new Set((Array.isArray(paths) ? paths : []).map((item) => `${item || ''}`.trim()).filter(Boolean))];
  if (!cleanPaths.length) return null;
  return cleanPaths.length === 1 ? cleanPaths[0] : JSON.stringify(cleanPaths);
};
const mergeUploadPaths = (existingValue, newPaths) => {
  const cleanNewPaths = Array.isArray(newPaths) ? newPaths.filter(Boolean) : [];
  if (!cleanNewPaths.length) return null;
  return serializeUploadPaths([...parseUploadPaths(existingValue), ...cleanNewPaths]);
};
const uploadHref = (filePath) => (filePath ? `/${String(filePath).replace(/\\/g, '/')}` : '');
const uploadFileName = (filePath) => (filePath ? String(filePath).replace(/\\/g, '/').split('/').pop() : '');
const findUserIdByEmail = async (email) => {
  const normalizedEmail = `${email || ''}`.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const user = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1').get(normalizedEmail);
  return user?.id || null;
};
const resolveRegistrationOwnerUserId = async (req, email) => {
  if (req.user?.role !== 'admin') return req.user.id;
  return (await findUserIdByEmail(email)) || req.user.id;
};
const getUploadsForUser = async (userId) => {
  const uploads = [];

  const studentRegs = await db.prepare(`
    SELECT id, student_full_name, baptism_certificate_path, first_communion_certificate_path, created_at
    FROM student_registrations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  studentRegs.forEach((reg) => {
    parseUploadPaths(reg.baptism_certificate_path).forEach((filePath) => {
      uploads.push({
        filePath,
        documentTypeKey: 'baptism',
        registrationTypeKey: 'faith_formation_children',
        registrationLabel: reg.student_full_name || '',
        registrationHref: `/registration/children/edit/${reg.id}`,
        createdAt: reg.created_at,
      });
    });
    parseUploadPaths(reg.first_communion_certificate_path).forEach((filePath) => {
      uploads.push({
        filePath,
        documentTypeKey: 'communion',
        registrationTypeKey: 'faith_formation_children',
        registrationLabel: reg.student_full_name || '',
        registrationHref: `/registration/children/edit/${reg.id}`,
        createdAt: reg.created_at,
      });
    });
  });

  const sponsorRegs = await db.prepare(`
    SELECT id, student_name, sponsor_name, sponsor_certificate_path, created_at
    FROM sponsor_confirmations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  sponsorRegs.forEach((reg) => {
    parseUploadPaths(reg.sponsor_certificate_path).forEach((filePath) => {
      uploads.push({
        filePath,
        documentTypeKey: 'sponsor_form_certificate_upload',
        registrationTypeKey: 'sponsor_confirmation_forms_header',
        registrationLabel: [reg.student_name, reg.sponsor_name].filter(Boolean).join(' / '),
        registrationHref: `/registration/sponsor-confirmation/edit/${reg.id}`,
        createdAt: reg.created_at,
      });
    });
  });

  return uploads.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};
const CERTIFICATE_UPLOAD_FIELD_NAMES = new Set([
  'baptism_certificate',
  'baptism_certificate[]',
  'first_communion_certificate',
  'first_communion_certificate[]',
]);
const normalizeCertificateUploads = (req, _res, next) => {
  const filesByField = {};
  (Array.isArray(req.files) ? req.files : []).forEach((file) => {
    if (!CERTIFICATE_UPLOAD_FIELD_NAMES.has(file.fieldname)) return;
    const normalizedFieldName = file.fieldname.replace(/\[\]$/, '');
    if (!filesByField[normalizedFieldName]) filesByField[normalizedFieldName] = [];
    filesByField[normalizedFieldName].push(file);
  });
  req.files = filesByField;
  next();
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });
const certificateUpload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    cb(null, CERTIFICATE_UPLOAD_FIELD_NAMES.has(file.fieldname));
  },
  limits: {
    files: 30,
  },
});
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

app.set('view engine', 'ejs');
app.locals.lang = 'en';
app.locals.t = (key) => translations.en[key] || humanizeTranslationKey(key);
app.locals.user = null;
app.locals.success = [];
app.locals.error = [];
app.locals.certificateUploadPaths = parseUploadPaths;
app.locals.uploadHref = uploadHref;
app.locals.uploadFileName = uploadFileName;
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

app.use(
  session({
    store: new MySqlSessionStore(),
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
  }),
);
app.use((req, _res, next) => {
  req.flash = (type, message) => {
    if (!req.session) return [];

    if (!req.session.flash) {
      req.session.flash = {};
    }

    if (typeof message !== 'undefined') {
      const values = Array.isArray(message) ? message : [message];
      req.session.flash[type] = (req.session.flash[type] || []).concat(values);
      return req.session.flash[type];
    }

    const messages = req.session.flash[type] || [];
    delete req.session.flash[type];
    return messages;
  };

  next();
});
app.use(passport.initialize());
app.use(passport.session());

app.get('/lang/:lang', (req, res) => {
  const selected = req.params.lang === 'es' ? 'es' : 'en';
  req.session.lang = selected;
  res.redirect(req.get('referer') || '/');
});

app.use((req, res, next) => {
  const lang = req.session.lang === 'es' ? 'es' : 'en';
  res.locals.lang = lang;
  res.locals.t = (key) => translations[lang][key] || translations.en[key] || humanizeTranslationKey(key);
  res.locals.isDeletedAccount = db.isDeletedAccount;
  res.locals.user = req.user;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  next();
});

const getDefaultFaithFormationYear = () => {
  return '2025-2026';
};

const parseFaithFormationStartYear = (schoolYear) => {
  const match = /^(\d{4})-(\d{4})$/.exec(`${schoolYear || ''}`.trim());
  return match ? Number(match[1]) : new Date().getFullYear();
};

const getRegistrationYearOptions = (baseYear = new Date().getFullYear()) => {
  const startYear = baseYear - 2;
  return Array.from({ length: 6 }, (_, offset) => {
    const year = startYear + offset;
    return `${year}-${year + 1}`;
  });
};

const getFaithFormationSettings = async () => {
  const rows = await db.prepare(
    'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)'
  ).all('current_registration_year', 'faith_formation_year');
  const map = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  const currentRegistrationYear =
    map.get('current_registration_year') ||
    map.get('faith_formation_year') ||
    getDefaultFaithFormationYear();
  const yearSetting = await db.prepare(
    'SELECT school_year, faith_formation_open, sponsor_form_open FROM registration_year_settings WHERE school_year = ?'
  ).get(currentRegistrationYear);
  const faithFormationRegistrationOpen = yearSetting?.faith_formation_open === 1;
  const sponsorFormRegistrationOpen = yearSetting?.sponsor_form_open === 1;
  return {
    schoolYear: currentRegistrationYear,
    currentRegistrationYear,
    faithFormationRegistrationOpen,
    sponsorFormRegistrationOpen,
  };
};

const getRegistrationYearStatusList = async (baseYear) => {
  const yearOptions = getRegistrationYearOptions(baseYear);
  const rows = await db.prepare(
    `SELECT school_year, faith_formation_open, sponsor_form_open
     FROM registration_year_settings
     WHERE school_year IN (${yearOptions.map(() => '?').join(', ')})`
  ).all(...yearOptions);
  const rowMap = new Map(rows.map((row) => [row.school_year, row]));
  return yearOptions.map((schoolYear) => ({
    schoolYear,
    faithFormationOpen: rowMap.get(schoolYear)?.faith_formation_open === 1,
    sponsorFormOpen: rowMap.get(schoolYear)?.sponsor_form_open === 1,
  }));
};

const canAccessRegistration = (user, isOpen, settings) => {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'catechist') return true;
  return Boolean(settings?.schoolYear) && Boolean(isOpen);
};

const requireRegistrationAccess = async (req, res, registrationType) => {
  const settings = await getFaithFormationSettings();
  const isOpen = registrationType === 'sponsor'
    ? settings.sponsorFormRegistrationOpen
    : settings.faithFormationRegistrationOpen;
  if (!canAccessRegistration(req.user, isOpen, settings)) {
    req.flash('error', `${registrationType === 'sponsor' ? 'Sponsor form' : 'Faith Formation registration'} is not currently open. Please contact the parish office.`);
    res.redirect('/dashboard');
    return null;
  }
  return settings;
};

const calculateFees = (familyCount, gradeLevel, registrationDateStr, schoolYear, sacramentalYear) => {
  const registrationFee = Number(familyCount) > 1 ? 200 : 150;
  const grade = `${gradeLevel}`.toLowerCase();
  const sacramentalFee = sacramentalYear === 'second_year_communion' ? 25
    : sacramentalYear === 'second_year_confirmation' ? 50
    : grade.includes('2') ? 25 : grade.includes('confirmation') ? 50 : 0;
  const registrationDate = registrationDateStr ? new Date(registrationDateStr) : new Date();
  const startYear = parseFaithFormationStartYear(schoolYear);
  const classesBegin = new Date(`${startYear}-09-08T00:00:00`);
  const lateFee = 0;
  return { registrationFee, sacramentalFee, lateFee, afterStart: registrationDate >= classesBegin };
};

const EUCHARISTIC_ADORATION_SLOT_MINUTES = 60;
const EUCHARISTIC_ADORATION_START_MINUTES = (8 * 60) + 30;
const EUCHARISTIC_ADORATION_END_MINUTES = 16 * 60;
const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;

const padTimePart = (value) => `${value}`.padStart(2, '0');
const timeValueToMinutes = (timeValue) => {
  const [hourText, minuteText] = `${timeValue}`.split(':');
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return Number.NaN;
  return (hour * 60) + minute;
};
const minutesToTimeValue = (minutes) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${padTimePart(hour)}:${padTimePart(minute)}`;
};
const formatTimeLabel = (timeValue) => {
  const [hourText, minuteText] = `${timeValue}`.split(':');
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${padTimePart(minute)} ${suffix}`;
};
const getEucharisticAdorationSlots = ({
  startTime = minutesToTimeValue(EUCHARISTIC_ADORATION_START_MINUTES),
  endTime = minutesToTimeValue(EUCHARISTIC_ADORATION_END_MINUTES),
} = {}) => {
  const slots = [];
  const startMinutes = timeValueToMinutes(startTime);
  const endMinutes = timeValueToMinutes(endTime);
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || startMinutes >= endMinutes) {
    return slots;
  }
  for (
    let start = startMinutes;
    start + EUCHARISTIC_ADORATION_SLOT_MINUTES <= endMinutes;
    start += EUCHARISTIC_ADORATION_SLOT_MINUTES
  ) {
    const startValue = minutesToTimeValue(start);
    const endValue = minutesToTimeValue(start + EUCHARISTIC_ADORATION_SLOT_MINUTES);
    slots.push({
      value: startValue,
      endValue,
      label: `${formatTimeLabel(startValue)} - ${formatTimeLabel(endValue)}`,
    });
  }
  return slots;
};
const getTodayDateValue = () => {
  const today = new Date();
  return `${today.getFullYear()}-${padTimePart(today.getMonth() + 1)}-${padTimePart(today.getDate())}`;
};
const formatDateValue = (dateValue) => {
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return `${dateValue.getFullYear()}-${padTimePart(dateValue.getMonth() + 1)}-${padTimePart(dateValue.getDate())}`;
  }
  return `${dateValue}`.slice(0, 10);
};
const formatAdorationDateLabel = (dateValue) => {
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return dateValue.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  const [yearText, monthText, dayText] = `${dateValue}`.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  if (!year || !month || !day) return dateValue;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};
const getAvailableAdorationDates = async ({ includePast = false } = {}) => {
  const rows = includePast
    ? await db.prepare(`
      SELECT id, adoration_date, start_time, end_time, created_at
      FROM eucharistic_adoration_available_dates
      ORDER BY adoration_date ASC
    `).all()
    : await db.prepare(`
      SELECT id, adoration_date, start_time, end_time, created_at
      FROM eucharistic_adoration_available_dates
      WHERE adoration_date >= ?
      ORDER BY adoration_date ASC
    `).all(getTodayDateValue());

  return rows.map((row) => ({
    ...row,
    value: formatDateValue(row.adoration_date),
    label: formatAdorationDateLabel(row.adoration_date),
    startTime: row.start_time || minutesToTimeValue(EUCHARISTIC_ADORATION_START_MINUTES),
    endTime: row.end_time || minutesToTimeValue(EUCHARISTIC_ADORATION_END_MINUTES),
    timeWindowLabel: `${formatTimeLabel(row.start_time || minutesToTimeValue(EUCHARISTIC_ADORATION_START_MINUTES))} - ${formatTimeLabel(row.end_time || minutesToTimeValue(EUCHARISTIC_ADORATION_END_MINUTES))}`,
    timeSlots: getEucharisticAdorationSlots({
      startTime: row.start_time || minutesToTimeValue(EUCHARISTIC_ADORATION_START_MINUTES),
      endTime: row.end_time || minutesToTimeValue(EUCHARISTIC_ADORATION_END_MINUTES),
    }),
  }));
};

const createVerificationToken = () => crypto.randomBytes(32).toString('hex');
const hashVerificationToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const generateTempPassword = (length = 12) => {
  const bytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += TEMP_PASSWORD_CHARS[bytes[i] % TEMP_PASSWORD_CHARS.length];
  }
  return password;
};
const getBaseUrl = (req) => process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
const issueVerificationForUser = async ({ userId, email, fullName, role, req }) => {
  const verificationToken = createVerificationToken();
  const verificationTokenHash = hashVerificationToken(verificationToken);
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(`
    UPDATE users
    SET is_active = 0,
        email_verified_at = NULL,
        email_verification_token = ?,
        email_verification_expires_at = ?
    WHERE id = ?
  `).run(verificationTokenHash, verificationExpiresAt, userId);

  const verificationUrl = `${getBaseUrl(req)}/verify-email?token=${verificationToken}`;
  console.info('[signup] Created inactive user pending verification', {
    email,
    role,
    baseUrl: getBaseUrl(req),
  });

  const delivery = await sendVerificationEmail({
    to: email,
    verificationUrl,
    fullName,
  });

  return { delivery, verificationUrl };
};
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const hasValue = (value) => value != null && `${value}`.trim() !== '';
const getListValues = (value) => `${value || ''}`
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const getIncompleteStudentRegistrationFields = (reg) => {
  const missing = [];

  if (!hasValue(reg.primary_contact_first_name)) missing.push('primary contact first name');
  if (!hasValue(reg.primary_contact_last_name)) missing.push('primary contact last name');
  if (!hasValue(reg.primary_contact_phone)) missing.push('primary contact phone');
  if (!hasValue(reg.primary_contact_email)) missing.push('primary contact email');
  if (!hasValue(reg.primary_contact_relationship)) missing.push('relationship to child');
  if (reg.primary_contact_relationship === 'Other' && !hasValue(reg.primary_contact_relationship_other)) {
    missing.push('relationship description');
  }
  if (!hasValue(reg.address)) missing.push('street address');
  if (!hasValue(reg.city_state_zip)) missing.push('city, state, and zip');
  if (!hasValue(reg.mother_maiden_name)) missing.push('mother maiden name');

  const studentNames = getListValues(reg.student_full_name);
  const studentGenders = getListValues(reg.student_gender);
  const studentDobs = getListValues(reg.student_dob);

  if (!studentNames.length) missing.push('student name');
  if (!studentGenders.length) missing.push('student gender');
  if (!studentDobs.length) missing.push('student date of birth');

  if (studentNames.length && (studentGenders.length < studentNames.length || studentDobs.length < studentNames.length)) {
    missing.push('all student gender and birth date entries');
  }

  return missing;
};

// ── Public routes ────────────────────────────────────────────
app.get('/', (req, res) => res.render('index'));
app.get('/steubenville-florida-youth-conference', (req, res) => res.render('steubenville-florida'));

app.get('/eucharistic-adoration', asyncHandler(async (req, res) => {
  const availableDates = await getAvailableAdorationDates();
  res.render('eucharistic-adoration-signup', {
    availableDates,
  });
}));

app.post('/eucharistic-adoration', asyncHandler(async (req, res) => {
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const adorationDate = typeof req.body.adoration_date === 'string' ? req.body.adoration_date.trim() : '';
  const slotStartTime = typeof req.body.slot_start_time === 'string' ? req.body.slot_start_time.trim() : '';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  const availableDates = await getAvailableAdorationDates();
  const selectedDate = availableDates.find((dateItem) => dateItem.value === adorationDate);
  const selectedSlot = selectedDate?.timeSlots?.find((slot) => slot.value === slotStartTime);

  if (!fullName || !email || !phone || !adorationDate || !selectedSlot) {
    req.flash('error', 'Please complete your name, email, phone, date, and adoration time slot.');
    return res.redirect('/eucharistic-adoration');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    req.flash('error', 'Please enter a valid email address.');
    return res.redirect('/eucharistic-adoration');
  }

  if (!phoneRegex.test(phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect('/eucharistic-adoration');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(adorationDate)) {
    req.flash('error', 'Please choose a valid adoration date.');
    return res.redirect('/eucharistic-adoration');
  }

  if (!selectedDate) {
    req.flash('error', 'That adoration date is not currently open for signup. Please choose one of the available dates.');
    return res.redirect('/eucharistic-adoration');
  }

  const existingSignup = await db.prepare(`
    SELECT id
    FROM eucharistic_adoration_signups
    WHERE adoration_date = ? AND slot_start_time = ?
    LIMIT 1
  `).get(adorationDate, selectedSlot.value);

  if (existingSignup) {
    req.flash('error', `That time slot on ${selectedDate.label} has already been reserved. Please choose another slot.`);
    return res.redirect('/eucharistic-adoration');
  }

  try {
    await db.prepare(`
      INSERT INTO eucharistic_adoration_signups
        (full_name, email, phone, adoration_date, slot_start_time, slot_end_time, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      fullName,
      email,
      phone,
      adorationDate,
      selectedSlot.value,
      selectedSlot.endValue,
      notes || null,
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      req.flash('error', `That time slot on ${selectedDate.label} has already been reserved. Please choose another slot.`);
      return res.redirect('/eucharistic-adoration');
    }
    throw error;
  }

  req.flash('success', `Your Eucharistic Adoration signup is confirmed for ${selectedDate.label} at ${selectedSlot.label}.`);
  return res.redirect('/eucharistic-adoration');
}));

app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', asyncHandler(async (req, res) => {
  const { email, password, requestedRole, inviteCode, firstName, lastName, phone } = req.body;
  if (!email || !password || !firstName?.trim() || !lastName?.trim() || !phone?.trim()) {
    req.flash('error', 'Email, first name, last name, phone, and password are required.');
    return res.redirect('/signup');
  }

  const normalizedEmail = email.toLowerCase();
  const trimmedFirstName = firstName.trim();
  const trimmedLastName = lastName.trim();
  const trimmedPhone = phone.trim();
  const trimmedFullName = `${trimmedFirstName} ${trimmedLastName}`.trim();
  if (!phoneRegex.test(trimmedPhone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect('/signup');
  }
  const existingAccount = await db.prepare('SELECT id, account_status FROM users WHERE email = ?').get(normalizedEmail);
  if (existingAccount && !db.isDeletedAccount(existingAccount)) {
    req.flash('error', 'Account already exists. Please log in.');
    return res.redirect('/login');
  }

  // Default role is 'user'. Staff roles require a valid invite code.
  let role = 'user';
  if (normalizedEmail === process.env.ADMIN_EMAIL?.toLowerCase()) {
    role = 'admin';
  } else if (requestedRole === 'admin' && inviteCode === process.env.ADMIN_INVITE_CODE) {
    role = 'admin';
  } else if (requestedRole === 'catechist' && inviteCode === process.env.CATECHIST_INVITE_CODE) {
    role = 'catechist';
  } else if (requestedRole === 'admin' || requestedRole === 'catechist') {
    req.flash('error', 'Invalid invite code. Please try again or contact the parish office.');
    return res.redirect('/signup');
  }

  const hash = bcrypt.hashSync(password, 10);
  if (existingAccount) {
    // A previously deleted account reusing this email: reactivate the row in place
    // rather than inserting a new one, since email stays UNIQUE across the table.
    await db.prepare(`
      UPDATE users
      SET password_hash = ?, role = ?, provider = 'local', full_name = ?, first_name = ?, last_name = ?, phone = ?,
          is_active = 0, account_status = 'active', email_verified_at = NULL,
          email_verification_token = NULL, email_verification_expires_at = NULL,
          password_reset_token = NULL, password_reset_expires_at = NULL
      WHERE id = ?
    `).run(hash, role, trimmedFullName, trimmedFirstName, trimmedLastName, trimmedPhone, existingAccount.id);
  } else {
    await db.prepare(`
      INSERT INTO users (
        email, password_hash, role, provider, full_name, first_name, last_name, phone, is_active, email_verification_token, email_verification_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
    `).run(
      normalizedEmail,
      hash,
      role,
      'local',
      trimmedFullName,
      trimmedFirstName,
      trimmedLastName,
      trimmedPhone,
    );
  }

  try {
    const { delivery, verificationUrl } = await issueVerificationForUser({
      userId: (await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)).id,
      email: normalizedEmail,
      fullName: trimmedFullName,
      role,
      req,
    });

    console.info('[signup] Verification email flow completed', {
      email: normalizedEmail,
      delivered: delivery.delivered,
      messageId: delivery.messageId || null,
      response: delivery.response || null,
    });

    return res.render('verify-email-sent', {
      email: normalizedEmail,
      emailDeliveryConfigured: delivery.delivered,
      verificationPreviewUrl:
        !delivery.delivered && process.env.NODE_ENV !== 'production' ? verificationUrl : null,
    });
  } catch (error) {
    console.error('[signup] Verification email failed', {
      email: normalizedEmail,
      message: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
      responseCode: error?.responseCode || null,
    });
    await db.prepare(`
      DELETE FROM users
      WHERE email = ? AND is_active = 0 AND COALESCE(account_status, 'active') <> 'deleted'
    `).run(normalizedEmail);
    req.flash('error', 'Unable to send verification email. Please try again.');
    return res.redirect('/signup');
  }
}));

app.get('/verify-email', asyncHandler(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    req.flash('error', 'Verification link is invalid.');
    return res.redirect('/login');
  }

  const tokenHash = hashVerificationToken(token);
  const user = await db.prepare(`
    SELECT id, email, is_active, account_status, email_verification_expires_at
    FROM users
    WHERE email_verification_token = ?
  `).get(tokenHash);

  if (!user) {
    req.flash('error', 'Verification link is invalid or has already been used.');
    return res.redirect('/login');
  }

  if (db.isDeletedAccount(user)) {
    req.flash('error', 'This account has been deleted.');
    return res.redirect('/login');
  }

  if (user.is_active) {
    req.flash('success', 'Your account is already active. Please log in.');
    return res.redirect('/login');
  }

  if (!user.email_verification_expires_at || new Date(user.email_verification_expires_at) < new Date()) {
    req.flash('error', 'Verification link has expired. Please sign up again.');
    return res.redirect('/signup');
  }

  await db.prepare(`
    UPDATE users
    SET is_active = 1, email_verified_at = CURRENT_TIMESTAMP,
        email_verification_token = NULL, email_verification_expires_at = NULL
    WHERE id = ?
  `).run(user.id);

  req.flash('success', `Email verified for ${user.email}. You can now log in.`);
  return res.redirect('/login');
}));

app.get('/login', (req, res) => res.render('login'));
app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true,
  }),
);

app.get('/forgot-password', (req, res) => res.render('forgot-password'));

app.post('/forgot-password', asyncHandler(async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  let previewUrl = null;

  if (email) {
    const user = await db.prepare('SELECT id, email, full_name, provider, account_status FROM users WHERE email = ?').get(email);
    if (user && user.provider === 'local' && !db.isDeletedAccount(user)) {
      const resetToken = createVerificationToken();
      const resetTokenHash = hashVerificationToken(resetToken);
      const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await db.prepare(`
        UPDATE users
        SET password_reset_token = ?, password_reset_expires_at = ?
        WHERE id = ?
      `).run(resetTokenHash, resetExpiresAt, user.id);

      const resetUrl = `${getBaseUrl(req)}/reset-password?token=${resetToken}`;
      const delivery = await sendPasswordResetEmail({ to: user.email, resetUrl, fullName: user.full_name });
      if (!delivery.delivered && process.env.NODE_ENV !== 'production') {
        previewUrl = resetUrl;
      }
    }
  }

  return res.render('forgot-password-sent', { email, previewUrl });
}));

app.get('/reset-password', asyncHandler(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    req.flash('error', 'Password reset link is invalid.');
    return res.redirect('/forgot-password');
  }
  const tokenHash = hashVerificationToken(token);
  const user = await db.prepare(
    'SELECT id, account_status, password_reset_expires_at FROM users WHERE password_reset_token = ?'
  ).get(tokenHash);

  if (!user || db.isDeletedAccount(user) || !user.password_reset_expires_at || new Date(user.password_reset_expires_at) < new Date()) {
    req.flash('error', 'Password reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/forgot-password');
  }

  return res.render('reset-password', { token });
}));

app.post('/reset-password', asyncHandler(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body.confirm_password === 'string' ? req.body.confirm_password : '';

  if (!token) {
    req.flash('error', 'Password reset link is invalid.');
    return res.redirect('/forgot-password');
  }

  const tokenHash = hashVerificationToken(token);
  const user = await db.prepare(
    'SELECT id, account_status, password_reset_expires_at FROM users WHERE password_reset_token = ?'
  ).get(tokenHash);

  if (!user || db.isDeletedAccount(user) || !user.password_reset_expires_at || new Date(user.password_reset_expires_at) < new Date()) {
    req.flash('error', 'Password reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/forgot-password');
  }

  if (password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect(`/reset-password?token=${token}`);
  }
  if (password !== confirmPassword) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect(`/reset-password?token=${token}`);
  }

  const hash = bcrypt.hashSync(password, 10);
  await db.prepare(`
    UPDATE users
    SET password_hash = ?, password_reset_token = NULL, password_reset_expires_at = NULL,
        is_active = 1, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
    WHERE id = ?
  `).run(hash, user.id);

  req.flash('success', 'Your password has been reset. You can now log in.');
  return res.redirect('/login');
}));

app.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).send('Google auth not configured.');
  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
app.get('/auth/google/callback',
  passport.authenticate('google', { successRedirect: '/dashboard', failureRedirect: '/login', failureFlash: true }));

app.get('/auth/github', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) return res.status(503).send('GitHub auth not configured.');
  return passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
});
app.get('/auth/github/callback',
  passport.authenticate('github', { successRedirect: '/dashboard', failureRedirect: '/login', failureFlash: true }));

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    return res.redirect('/');
  });
});

app.get('/account', requireAuth, asyncHandler(async (req, res) => {
  const account = await db.prepare(`
    SELECT id, email, role, provider, full_name, first_name, last_name, phone,
           is_active, email_verified_at, created_at
    FROM users
    WHERE id = ?
  `).get(req.user.id);
  if (!account) return res.status(404).send('Account not found.');

  res.render('account-profile', { account });
}));

app.get('/account/uploads', requireAuth, asyncHandler(async (req, res) => {
  const uploads = await getUploadsForUser(req.user.id);
  res.render('account-uploads', { uploads, targetUser: null, adminView: false });
}));

app.get('/account/password', requireAuth, (req, res) => res.render('change-password'));

app.post('/account/password', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.provider !== 'local') {
    req.flash('error', `Your account signs in with ${req.user.provider === 'google' ? 'Google' : 'GitHub'}, so there's no password to change here.`);
    return res.redirect('/account/password');
  }

  const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';
  const confirmPassword = typeof req.body.confirm_password === 'string' ? req.body.confirm_password : '';

  const user = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user || !user.password_hash || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/account/password');
  }
  if (newPassword.length < 8) {
    req.flash('error', 'New password must be at least 8 characters.');
    return res.redirect('/account/password');
  }
  if (newPassword !== confirmPassword) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/account/password');
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user.id);

  req.flash('success', 'Your password has been updated.');
  return res.redirect('/dashboard');
}));

// ── Dashboard ────────────────────────────────────────────────
app.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const faithFormationSettings = await getFaithFormationSettings();

  // Every role sees only registrations they personally initiated here — catechists get
  // their actual class rosters from the separate, properly-scoped My Classes feature
  // instead of a blanket view of every family's registrations.
  const studentRegs = await db.prepare('SELECT * FROM student_registrations WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(req.user.id);

  const feeBreakdown = studentRegs
    .filter((reg) => String(reg.user_id) === String(req.user.id))
    .map((reg) => {
      const registrationFee = reg.registration_fee || 0;
      const sacramentalFee = reg.sacramental_fee || 0;
      const lateFee = reg.late_fee || 0;
      return {
        name: reg.student_full_name,
        registrationFee,
        sacramentalFee,
        lateFee,
        total: registrationFee + sacramentalFee + lateFee,
      };
    });
  const totalFeesDue = feeBreakdown.reduce((sum, item) => sum + item.total, 0);

  const familyRegsRaw = await db.prepare('SELECT * FROM family_faith_registrations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  const adultRegs = await db.prepare('SELECT * FROM adult_registrations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  const familyRegs = familyRegsRaw.map((reg) => ({
    ...reg,
    members: parseFamilyMembersFromStorage(reg.members_json),
  }));

  const sponsorRegs = await db.prepare('SELECT * FROM sponsor_confirmations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  res.render('dashboard', { studentRegs, familyRegs, adultRegs, sponsorRegs, ADULT_PROGRAMS, faithFormationSettings, resolveCcdGrade, feeBreakdown, totalFeesDue });
}));

app.get('/family-faith/visits/availability', requireAuth, asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const isLeader = req.user.role === 'family_faith_leader';
  if (!isAdmin && !isLeader) {
    return res.status(403).send('Forbidden: insufficient privileges.');
  }

  const selectedLeaderId = isAdmin
    ? Number(req.query.leader_user_id || 0) || null
    : req.user.id;
  const leaders = await getFamilyFaithLeaders();
  const effectiveLeaderId = selectedLeaderId || (!isAdmin ? req.user.id : (leaders[0]?.id || null));
  const visitSlots = effectiveLeaderId
    ? await getManagedFamilyFaithVisitSlots({ leaderUserId: effectiveLeaderId })
    : [];

  res.render('family-visit-availability', {
    leaders,
    visitSlots,
    selectedLeaderId: effectiveLeaderId,
    isAdmin,
  });
}));

app.post('/family-faith/visits/availability', requireAuth, asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const isLeader = req.user.role === 'family_faith_leader';
  if (!isAdmin && !isLeader) {
    return res.status(403).send('Forbidden: insufficient privileges.');
  }

  const leaderUserId = isAdmin
    ? Number(req.body.leader_user_id || 0) || null
    : req.user.id;
  if (!leaderUserId) {
    req.flash('error', 'Please choose a family faith formation leader.');
    return res.redirect('/family-faith/visits/availability');
  }

  const leader = await db.prepare(
    `SELECT id FROM users WHERE id = ? AND role = ? AND COALESCE(account_status, 'active') <> 'deleted'`
  ).get(leaderUserId, 'family_faith_leader');
  if (!leader) {
    req.flash('error', 'Selected user is not a family faith formation leader.');
    return res.redirect('/family-faith/visits/availability');
  }

  const visitDate = typeof req.body.visit_date === 'string' ? req.body.visit_date.trim() : '';
  const startTime = typeof req.body.start_time === 'string' ? req.body.start_time.trim() : '';
  const endTime = typeof req.body.end_time === 'string' ? req.body.end_time.trim() : '';
  const slots = buildThirtyMinuteVisitSlots(visitDate, startTime, endTime);
  if (!slots.length) {
    req.flash('error', 'Please enter a valid date and time range in 30-minute increments.');
    return res.redirect(`/family-faith/visits/availability${isAdmin ? `?leader_user_id=${leaderUserId}` : ''}`);
  }

  for (const slot of slots) {
    const existing = await db.prepare(
      'SELECT id FROM family_faith_visit_slots WHERE leader_user_id = ? AND slot_start = ? AND slot_end = ? LIMIT 1'
    ).get(
      leaderUserId,
      toSqlDateTime(slot.slotStart),
      toSqlDateTime(slot.slotEnd)
    );
    if (existing) continue;

    await db.prepare(
      'INSERT INTO family_faith_visit_slots (leader_user_id, slot_start, slot_end) VALUES (?, ?, ?)'
    ).run(
      leaderUserId,
      toSqlDateTime(slot.slotStart),
      toSqlDateTime(slot.slotEnd)
    );
  }

  req.flash('success', res.locals.t('slots_created'));
  return res.redirect(`/family-faith/visits/availability${isAdmin ? `?leader_user_id=${leaderUserId}` : ''}`);
}));

app.post('/family-faith/visits/availability/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const isLeader = req.user.role === 'family_faith_leader';
  if (!isAdmin && !isLeader) {
    return res.status(403).send('Forbidden: insufficient privileges.');
  }

  const slot = await db.prepare('SELECT id, leader_user_id, booked_registration_id FROM family_faith_visit_slots WHERE id = ?').get(req.params.id);
  if (!slot) {
    req.flash('error', 'Visit slot not found.');
    return res.redirect('/family-faith/visits/availability');
  }
  if (!isAdmin && slot.leader_user_id !== req.user.id) {
    return res.status(403).send('Forbidden: insufficient privileges.');
  }
  if (slot.booked_registration_id) {
    req.flash('error', 'This Visit slot is already booked and cannot be removed.');
    return res.redirect(`/family-faith/visits/availability${isAdmin ? `?leader_user_id=${slot.leader_user_id}` : ''}`);
  }

  await db.prepare('DELETE FROM family_faith_visit_slots WHERE id = ?').run(req.params.id);
  req.flash('success', res.locals.t('visit_slot_removed'));
  return res.redirect(`/family-faith/visits/availability${isAdmin ? `?leader_user_id=${slot.leader_user_id}` : ''}`);
}));

app.get('/calendar', requireAuth, asyncHandler(async (req, res) => {
  const monthParam = typeof req.query.month === 'string' ? req.query.month.trim() : '';
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthParam);
  const baseDate = monthMatch
    ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
    : new Date();
  const year = baseDate.getFullYear();
  const monthIndex = baseDate.getMonth();
  const monthStart = new Date(year, monthIndex, 1);
  const previousMonth = new Date(year, monthIndex - 1, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const scheduledEvents = await getAllScheduledFaithFormationEvents();
  const occurrences = expandScheduledEventsForMonth(scheduledEvents, year, monthIndex);
  const weeks = buildCalendarWeeks(occurrences, year, monthIndex);

  res.render('calendar', {
    calendarMonthLabel: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    previousMonthParam: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`,
    nextMonthParam: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`,
    weeks,
    weekdayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthEvents: occurrences,
  });
}));

// ── Children Faith Formation ─────────────────────────────────
app.get('/registration/children', requireAuth, asyncHandler(async (req, res) => {
  const faithFormationSettings = await requireRegistrationAccess(req, res, 'faith_formation');
  if (!faithFormationSettings) return;
  const today = new Date().toISOString().slice(0, 10);

  const stage = req.query.stage === 'student' ? 'student' : 'intro';
  const totalChildren = Number.parseInt(req.query.total, 10) || null;
  const studentIndex = Number.parseInt(req.query.index, 10) || 1;
  const groupIds = `${req.query.groupIds || ''}`.split(',').map((s) => s.trim()).filter(Boolean).map(Number);

  let parentInfo = null;
  let studentPrefill = null;
  let currentRegistrationId = null;

  if (stage === 'student' && groupIds.length) {
    parentInfo = await db.prepare(
      'SELECT * FROM student_registrations WHERE id = ? AND user_id = ?'
    ).get(groupIds[0], req.user.id);

    if (parentInfo) {
      const addressParts = parentInfo.city_state_zip ? parentInfo.city_state_zip.split(', ') : ['', '', ''];
      parentInfo.city = addressParts[0] || '';
      parentInfo.state = addressParts[1] ? addressParts[1].split(' ')[0] : '';
      parentInfo.zip = addressParts[1] ? addressParts[1].split(' ')[1] : '';
    }

    if (studentIndex <= groupIds.length) {
      studentPrefill = await db.prepare(
        'SELECT * FROM student_registrations WHERE id = ? AND user_id = ?'
      ).get(groupIds[studentIndex - 1], req.user.id);
      currentRegistrationId = studentPrefill ? studentPrefill.id : null;
    }
  }

  res.render('registration-form', {
    today,
    reg: parentInfo,
    editing: false,
    isStaff: false,
    schoolYearLabel: `${res.locals.t('school_year')} ${faithFormationSettings.schoolYear}`,
    activeSchoolYear: faithFormationSettings.schoolYear,
    statusOptions: STUDENT_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['children', 'general']),
    stage,
    totalChildren,
    studentIndex,
    groupIds,
    parentInfo,
    studentPrefill,
    currentRegistrationId,
    ccdClasses: await getCcdClasses(),
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
  });
}));

app.get('/registration/sponsor-confirmation', requireAuth, asyncHandler(async (req, res) => {
  const faithFormationSettings = await requireRegistrationAccess(req, res, 'sponsor');
  if (!faithFormationSettings) return;
  res.render('sponsor-confirmation-form', {
    reg: null,
    schoolYearLabel: `School Year ${faithFormationSettings.schoolYear}`,
  });
}));

app.get('/registration/sponsor-confirmation/edit/:id', requireAuth, asyncHandler(async (req, res) => {
  const faithFormationSettings = await getFaithFormationSettings();
  const isStaff = req.user.role === 'admin' || req.user.role === 'catechist';
  const reg = await db.prepare(
    'SELECT * FROM sponsor_confirmations WHERE id = ? AND (user_id = ? OR ? = 1)'
  ).get(req.params.id, req.user.id, isStaff ? 1 : 0);

  if (!reg) {
    return res.status(404).send('Sponsor confirmation form not found.');
  }

  res.render('sponsor-confirmation-form', {
    reg,
    schoolYearLabel: `School Year ${faithFormationSettings.schoolYear}`,
  });
}));

app.post('/registration/sponsor-confirmation', requireAuth, upload.single('sponsor_certificate'), asyncHandler(async (req, res) => {
  const faithFormationSettings = await getFaithFormationSettings();
  const registrationId = Number(req.body.registration_id);
  if ((!Number.isInteger(registrationId) || registrationId <= 0) && !canAccessRegistration(req.user, faithFormationSettings.sponsorFormRegistrationOpen, faithFormationSettings)) {
    req.flash('error', 'Sponsor form is not currently open. Please contact the parish office.');
    return res.redirect('/dashboard');
  }
  const saveMode = typeof req.body.save_mode === 'string' ? req.body.save_mode.trim() : '';
  const savingIncomplete = saveMode === 'incomplete';
  const studentName = typeof req.body.student_name === 'string' ? req.body.student_name.trim() : '';
  const confirmationName = typeof req.body.confirmation_name === 'string' ? req.body.confirmation_name.trim() : '';
  const sponsorName = typeof req.body.sponsor_name === 'string' ? req.body.sponsor_name.trim() : '';
  const sponsorAddress = typeof req.body.sponsor_address === 'string' ? req.body.sponsor_address.trim() : '';
  const sponsorCity = typeof req.body.sponsor_city === 'string' ? req.body.sponsor_city.trim() : '';
  const sponsorState = typeof req.body.sponsor_state === 'string' ? req.body.sponsor_state.trim() : '';
  const sponsorZip = typeof req.body.sponsor_zip === 'string' ? req.body.sponsor_zip.trim() : '';
  const isStMatthewParishioner = req.body.is_st_matthew_parishioner === '1' ? 1 : 0;
  const sponsorCertificatePath = getPublicUploadPath(req.file);
  const isCompleteForm = Boolean(
    studentName &&
    confirmationName &&
    sponsorName &&
    sponsorAddress &&
    sponsorCity &&
    sponsorState &&
    sponsorZip
  );
  const hasCertificateRequirementMet = isStMatthewParishioner || Boolean(sponsorCertificatePath);
  const shouldSaveAsIncomplete = savingIncomplete || !isCompleteForm || !hasCertificateRequirementMet;
  const nextStatus = shouldSaveAsIncomplete ? 'incomplete' : 'in_progress';

  if (!shouldSaveAsIncomplete && !isCompleteForm) {
    req.flash('error', 'Please complete all sponsor confirmation fields.');
    const redirectUrl = Number.isInteger(registrationId) && registrationId > 0
      ? `/registration/sponsor-confirmation/edit/${registrationId}`
      : '/registration/sponsor-confirmation';
    return res.redirect(redirectUrl);
  }

  if (Number.isInteger(registrationId) && registrationId > 0) {
    const isStaff = req.user.role === 'admin' || req.user.role === 'catechist';
    const existing = await db.prepare(
      'SELECT id, sponsor_certificate_path FROM sponsor_confirmations WHERE id = ? AND (user_id = ? OR ? = 1)'
    ).get(registrationId, req.user.id, isStaff ? 1 : 0);

    if (!existing) {
      return res.status(404).send('Sponsor confirmation form not found.');
    }

    const certificateRequirementMet = isStMatthewParishioner || Boolean(sponsorCertificatePath) || Boolean(existing.sponsor_certificate_path);
    const shouldKeepIncomplete = shouldSaveAsIncomplete || !certificateRequirementMet;

    if (!shouldKeepIncomplete && !certificateRequirementMet) {
      req.flash('error', 'Please attach a Sponsor Certificate, or mark the sponsor as a St. Matthew parishioner in good standing.');
      return res.redirect(`/registration/sponsor-confirmation/edit/${registrationId}`);
    }

    await db.prepare(`
      UPDATE sponsor_confirmations
      SET student_name = ?, confirmation_name = ?, sponsor_name = ?, sponsor_address = ?,
          sponsor_city = ?, sponsor_state = ?, sponsor_zip = ?, is_st_matthew_parishioner = ?,
          sponsor_certificate_path = CASE WHEN ? = 1 THEN sponsor_certificate_path ELSE COALESCE(?, sponsor_certificate_path) END,
          admin_verified = 0,
          admin_verified_at = NULL,
          status = ?
      WHERE id = ?
    `).run(
      studentName,
      confirmationName,
      sponsorName,
      sponsorAddress,
      sponsorCity,
      sponsorState,
      sponsorZip,
      isStMatthewParishioner,
      isStMatthewParishioner,
      sponsorCertificatePath,
      shouldKeepIncomplete ? 'incomplete' : 'in_progress',
      registrationId
    );

    req.flash('success', shouldKeepIncomplete ? res.locals.t('sponsor_form_incomplete_saved') : res.locals.t('sponsor_form_submitted_saved'));
    return res.redirect('/dashboard');
  }

  if (!shouldSaveAsIncomplete && !isStMatthewParishioner && !sponsorCertificatePath) {
    req.flash('error', 'Please attach a Sponsor Certificate, or mark the sponsor as a St. Matthew parishioner in good standing.');
    return res.redirect('/registration/sponsor-confirmation');
  }

  await db.prepare(`
    INSERT INTO sponsor_confirmations
      (user_id, student_name, confirmation_name, sponsor_name, sponsor_address, sponsor_city, sponsor_state, sponsor_zip, is_st_matthew_parishioner, sponsor_certificate_path, admin_verified, admin_verified_at, student_signature, parent_signature, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    studentName,
    confirmationName,
    sponsorName,
    sponsorAddress,
    sponsorCity,
    sponsorState,
    sponsorZip,
    isStMatthewParishioner,
    sponsorCertificatePath,
    0,
    null,
    null,
    null,
    nextStatus
  );

  req.flash('success', shouldSaveAsIncomplete ? res.locals.t('sponsor_form_incomplete_saved') : res.locals.t('sponsor_form_submitted_saved'));
  return res.redirect('/dashboard');
}));

app.post('/admin/sponsor-confirmation/:id/verify', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const registrationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(registrationId)) {
    req.flash('error', 'Invalid sponsor confirmation form.');
    return res.redirect('/dashboard');
  }

  const registration = await db.prepare(
    'SELECT id, is_st_matthew_parishioner FROM sponsor_confirmations WHERE id = ?'
  ).get(registrationId);
  if (!registration) {
    req.flash('error', 'Sponsor confirmation form not found.');
    return res.redirect('/dashboard');
  }
  if (!registration.is_st_matthew_parishioner) {
    req.flash('error', 'Only St. Matthew parishioner sponsors require admin verification.');
    return res.redirect('/dashboard');
  }

  await db.prepare(`
    UPDATE sponsor_confirmations
    SET admin_verified = 1, admin_verified_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(registrationId);

  req.flash('success', 'Sponsor was verified as a St. Matthew parishioner in good standing.');
  return res.redirect('/dashboard');
}));

app.post('/admin/sponsor-confirmation/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const registrationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(registrationId)) {
    req.flash('error', 'Invalid sponsor confirmation form.');
    return res.redirect('/dashboard');
  }

  const registration = await db.prepare(`
    SELECT id, student_name, sponsor_name
    FROM sponsor_confirmations
    WHERE id = ?
  `).get(registrationId);
  if (!registration) {
    req.flash('error', 'Sponsor confirmation form not found.');
    return res.redirect('/dashboard');
  }

  await db.prepare('DELETE FROM sponsor_confirmations WHERE id = ?').run(registrationId);

  req.flash('success', `Deleted sponsor confirmation form for ${registration.student_name} / ${registration.sponsor_name}.`);
  return res.redirect('/dashboard');
}));

const handleChildrenRegistration = asyncHandler(async (req, res) => {
    const faithFormationSettings = await requireRegistrationAccess(req, res, 'faith_formation');
    if (!faithFormationSettings) return;
    const isAdmin = req.user.role === 'admin';
    const orNull = (v) => (v === undefined || v === '' ? null : v);
    const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
    if (requestedStatus && !STUDENT_REGISTRATION_STATUSES.includes(requestedStatus)) {
      req.flash('error', 'Invalid registration status.');
      const redirectUrl = req.body.registration_id ? `/registration/children/edit/${req.body.registration_id}` : '/registration/children';
      return res.redirect(redirectUrl);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
    const baptismCertFiles = getPublicUploadPaths(req.files?.baptism_certificate);
    const communionCertFiles = getPublicUploadPaths(req.files?.first_communion_certificate);

    const totalChildren = Number.parseInt(req.body.total_children, 10);
    const isWizardSubmission = Number.isInteger(totalChildren) && totalChildren > 0;

    if (isWizardSubmission) {
      // ── Registration wizard: one student saved per request ──────────────
      const studentIndex = Number.parseInt(req.body.student_index, 10) || 1;
      const priorGroupIds = `${req.body.group_ids || ''}`.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
      const isLastStage = studentIndex >= totalChildren;
      const stageRedirect = `/registration/children?stage=student&index=${studentIndex}&groupIds=${priorGroupIds.join(',')}&total=${totalChildren}`;

      const fees = calculateFees(totalChildren, null, null, faithFormationSettings.schoolYear, req.body.sacramental_year);
      if (fees.afterStart) {
        req.flash('error', `Registration closed: no registrations accepted after classes begin on Sept. 8, ${parseFaithFormationStartYear(faithFormationSettings.schoolYear)}.`);
        return res.redirect('/registration/children');
      }

      if (!emailRegex.test(req.body.primary_contact_email)) {
        req.flash('error', 'Invalid email format.');
        return res.redirect(stageRedirect);
      }
      if (!phoneRegex.test(req.body.primary_contact_phone)) {
        req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
        return res.redirect(stageRedirect);
      }

      const firstName = (req.body.student_first_name || '').trim();
      const lastName = (req.body.student_last_name || '').trim();
      const gender = (req.body.student_gender || '').trim();
      const dob = (req.body.student_dob || '').trim();
      if (!firstName || !lastName || !gender || !dob) {
        req.flash('error', 'Please fill in the student’s first name, last name, gender, and date of birth.');
        return res.redirect(stageRedirect);
      }

      const studentFullName = [firstName, (req.body.student_middle_name || '').trim(), lastName].filter(Boolean).join(' ');
      const city = (req.body.child_place_of_birth_city || '').trim();
      const country = (req.body.child_place_of_birth_country || '').trim();
      const placeOfBirthLegacy = [city, country].filter(Boolean).join(', ') || null;

      const rowRegistrationFee = studentIndex === 1 ? fees.registrationFee : 0;
      const existingRowId = req.body.registration_id ? Number(req.body.registration_id) : null;
      let registrationOwnerUserId = req.user.id;
      if (existingRowId) {
        const existingOwnerRow = await db.prepare(
          'SELECT user_id FROM student_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
        ).get(existingRowId, req.user.id, isAdmin ? 1 : 0);
        registrationOwnerUserId = existingOwnerRow?.user_id || req.user.id;
      } else if (priorGroupIds.length) {
        const groupOwnerRow = await db.prepare(
          'SELECT user_id FROM student_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
        ).get(priorGroupIds[0], req.user.id, isAdmin ? 1 : 0);
        registrationOwnerUserId = groupOwnerRow?.user_id || req.user.id;
      } else {
        registrationOwnerUserId = await resolveRegistrationOwnerUserId(req, req.body.primary_contact_email);
      }
      const existingRowForUploads = existingRowId
        ? await db.prepare(`
            SELECT baptism_certificate_path, first_communion_certificate_path
            FROM student_registrations
            WHERE id = ? AND (user_id = ? OR ? = 1)
          `).get(existingRowId, req.user.id, isAdmin ? 1 : 0)
        : null;
      const baptismCert = existingRowId
        ? mergeUploadPaths(existingRowForUploads?.baptism_certificate_path, baptismCertFiles)
        : serializeUploadPaths(baptismCertFiles);
      const communionCert = existingRowId
        ? mergeUploadPaths(existingRowForUploads?.first_communion_certificate_path, communionCertFiles)
        : serializeUploadPaths(communionCertFiles);

      let thisRowId;
      if (existingRowId) {
        await db.prepare(`
          UPDATE student_registrations SET
            parent_name = ?, primary_contact_first_name = ?, primary_contact_last_name = ?,
            primary_contact_phone = ?, primary_contact_email = ?, primary_contact_religion = ?,
            primary_contact_relationship = ?, primary_contact_relationship_other = ?,
            address = ?, city_state_zip = ?, home_phone = ?,
            father_name = ?, father_religion = ?, father_cell = ?,
            mother_maiden_name = ?, mother_religion = ?, mother_cell = ?,
            child_lives_with = ?, step_parent_name = ?, step_parent_religion = ?,
            student_full_name = ?, student_gender = ?,
            student_dob = ?, child_place_of_birth = ?, child_place_of_birth_city = ?, child_place_of_birth_country = ?,
            school_attending = ?, school_grade_level = ?,
            baptism_date = ?, baptism_church = ?,
            first_communion_date = ?, first_communion_church = ?, not_baptized = ?,
            sacramental_year = ?, preferred_class_time = ?, non_sacramental_grade = ?,
            disabilities_comments = ?, parent_signature = ?, email = ?,
            registration_fee = ?, sacramental_fee = ?, late_fee = ?,
            baptism_certificate_path = COALESCE(?, baptism_certificate_path),
            first_communion_certificate_path = COALESCE(?, first_communion_certificate_path),
            status = ?
          WHERE id = ? AND (user_id = ? OR ? = 1)
        `).run(
          `${req.body.primary_contact_first_name || ''} ${req.body.primary_contact_last_name || ''}`,
          orNull(req.body.primary_contact_first_name), orNull(req.body.primary_contact_last_name),
          orNull(req.body.primary_contact_phone), orNull(req.body.primary_contact_email), orNull(req.body.primary_contact_religion),
          orNull(req.body.primary_contact_relationship),
          req.body.primary_contact_relationship === 'Other' ? orNull(req.body.primary_contact_relationship_other) : null,
          orNull(req.body.address), `${req.body.city || ''}, ${req.body.state || ''} ${req.body.zip || ''}`, orNull(req.body.home_phone),
          orNull(req.body.father_name), orNull(req.body.father_religion), orNull(req.body.father_cell),
          orNull(req.body.mother_maiden_name), orNull(req.body.mother_religion), orNull(req.body.mother_cell),
          orNull(req.body.child_lives_with), orNull(req.body.step_parent_name), orNull(req.body.step_parent_religion),
          studentFullName, gender,
          dob, placeOfBirthLegacy, orNull(city), orNull(country),
          orNull(req.body.school_attending), orNull(req.body.school_grade_level),
          req.body.not_baptized ? null : orNull(req.body.baptism_date), req.body.not_baptized ? null : orNull(req.body.baptism_church),
          req.body.not_baptized ? null : orNull(req.body.first_communion_date), req.body.not_baptized ? null : orNull(req.body.first_communion_church), req.body.not_baptized ? 1 : 0,
          req.body.sacramental_year || null, req.body.preferred_class_time || null, orNull(req.body.non_sacramental_grade),
          orNull(req.body.disabilities_comments), orNull(req.body.parent_signature), orNull(req.body.email),
          rowRegistrationFee, fees.sacramentalFee, fees.lateFee,
          baptismCert, communionCert,
          isLastStage ? 'in_progress' : 'incomplete',
          existingRowId, req.user.id, isAdmin ? 1 : 0
        );
        thisRowId = existingRowId;
      } else {
        const result = await db.prepare(`
          INSERT INTO student_registrations (
            user_id, school_year, parent_name, primary_contact_first_name, primary_contact_last_name,
            primary_contact_phone, primary_contact_email, primary_contact_religion,
            primary_contact_relationship, primary_contact_relationship_other, address, city_state_zip, home_phone,
            father_name, father_religion, father_cell, mother_maiden_name, mother_religion, mother_cell,
            child_lives_with, step_parent_name, step_parent_religion, student_full_name, student_gender,
            student_dob, child_place_of_birth, child_place_of_birth_city, child_place_of_birth_country,
            school_attending, school_grade_level,
            baptism_date, baptism_church, first_communion_date, first_communion_church, not_baptized,
            sacramental_year, preferred_class_time, non_sacramental_grade,
            disabilities_comments, parent_signature, email, registration_fee, sacramental_fee, late_fee,
            baptism_certificate_path, first_communion_certificate_path, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          registrationOwnerUserId, faithFormationSettings.schoolYear,
          `${req.body.primary_contact_first_name || ''} ${req.body.primary_contact_last_name || ''}`,
          orNull(req.body.primary_contact_first_name), orNull(req.body.primary_contact_last_name),
          orNull(req.body.primary_contact_phone), orNull(req.body.primary_contact_email), orNull(req.body.primary_contact_religion),
          orNull(req.body.primary_contact_relationship),
          req.body.primary_contact_relationship === 'Other' ? orNull(req.body.primary_contact_relationship_other) : null,
          orNull(req.body.address), `${req.body.city || ''}, ${req.body.state || ''} ${req.body.zip || ''}`, orNull(req.body.home_phone),
          orNull(req.body.father_name), orNull(req.body.father_religion), orNull(req.body.father_cell),
          orNull(req.body.mother_maiden_name), orNull(req.body.mother_religion), orNull(req.body.mother_cell),
          orNull(req.body.child_lives_with), orNull(req.body.step_parent_name), orNull(req.body.step_parent_religion),
          studentFullName, gender,
          dob, placeOfBirthLegacy, orNull(city), orNull(country),
          orNull(req.body.school_attending), orNull(req.body.school_grade_level),
          req.body.not_baptized ? null : orNull(req.body.baptism_date), req.body.not_baptized ? null : orNull(req.body.baptism_church),
          req.body.not_baptized ? null : orNull(req.body.first_communion_date), req.body.not_baptized ? null : orNull(req.body.first_communion_church), req.body.not_baptized ? 1 : 0,
          req.body.sacramental_year || null, req.body.preferred_class_time || null, orNull(req.body.non_sacramental_grade),
          orNull(req.body.disabilities_comments), orNull(req.body.parent_signature), orNull(req.body.email),
          rowRegistrationFee, fees.sacramentalFee, fees.lateFee,
          baptismCert, communionCert,
          isLastStage ? 'in_progress' : 'incomplete',
        );
        thisRowId = result.lastInsertRowid;
      }

      const groupIdsAfter = existingRowId ? priorGroupIds : [...priorGroupIds, thisRowId];

      if (isLastStage) {
        if (groupIdsAfter.length) {
          const placeholders = groupIdsAfter.map(() => '?').join(', ');
          await db.prepare(
            `UPDATE student_registrations SET status = 'in_progress' WHERE id IN (${placeholders}) AND (user_id = ? OR ? = 1)`
          ).run(...groupIdsAfter, registrationOwnerUserId, isAdmin ? 1 : 0);
        }
        const totalsRow = await db.prepare(
          `SELECT SUM(registration_fee + sacramental_fee + late_fee) AS total FROM student_registrations WHERE id IN (${groupIdsAfter.map(() => '?').join(', ')})`
        ).get(...groupIdsAfter);
        const totalFeesCharged = totalsRow?.total || 0;
        req.flash('success', `Registration submitted. Total fees: $${totalFeesCharged}`);
        return res.redirect('/dashboard');
      }

      return res.redirect(`/registration/children?stage=student&index=${studentIndex + 1}&groupIds=${groupIdsAfter.join(',')}&total=${totalChildren}`);
    }

    // ── Admin editing a single existing registration (outside the wizard) ──
    const fees = calculateFees(1, req.body.ccd_grade_level, null, faithFormationSettings.schoolYear, req.body.sacramental_year);
    if (fees.afterStart) {
      req.flash('error', `Registration closed: no registrations accepted after classes begin on Sept. 8, ${parseFaithFormationStartYear(faithFormationSettings.schoolYear)}.`);
      return res.redirect('/registration/children');
    }
    if (!emailRegex.test(req.body.primary_contact_email)) {
      req.flash('error', 'Invalid email format.');
      return res.redirect(`/registration/children/edit/${req.body.registration_id}`);
    }
    if (!phoneRegex.test(req.body.primary_contact_phone)) {
      req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
      return res.redirect(`/registration/children/edit/${req.body.registration_id}`);
    }

    const existingReg = await db.prepare(
      'SELECT id, status, baptism_certificate_path, first_communion_certificate_path FROM student_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
    ).get(req.body.registration_id, req.user.id, isAdmin ? 1 : 0);
    if (!existingReg) {
      return res.status(404).send('Registration not found.');
    }

    const nextStatus = isAdmin && requestedStatus ? requestedStatus : existingReg.status;
    const baptismCert = mergeUploadPaths(existingReg.baptism_certificate_path, baptismCertFiles);
    const communionCert = mergeUploadPaths(existingReg.first_communion_certificate_path, communionCertFiles);
    const studentFullName = [(req.body.student_first_name || '').trim(), (req.body.student_middle_name || '').trim(), (req.body.student_last_name || '').trim()].filter(Boolean).join(' ') || null;
    const city = (req.body.child_place_of_birth_city || '').trim();
    const country = (req.body.child_place_of_birth_country || '').trim();
    const placeOfBirthLegacy = [city, country].filter(Boolean).join(', ') || null;

    await db.prepare(`
      UPDATE student_registrations SET
        parent_name = ?, primary_contact_first_name = ?, primary_contact_last_name = ?,
        primary_contact_phone = ?, primary_contact_email = ?, primary_contact_religion = ?,
        primary_contact_relationship = ?, primary_contact_relationship_other = ?,
        address = ?, city_state_zip = ?, home_phone = ?,
        father_name = ?, father_religion = ?, father_cell = ?,
        mother_maiden_name = ?, mother_religion = ?, mother_cell = ?,
        child_lives_with = ?, step_parent_name = ?, step_parent_religion = ?,
        student_full_name = ?, student_gender = ?,
        student_dob = ?, child_place_of_birth = ?, child_place_of_birth_city = ?, child_place_of_birth_country = ?, ccd_grade_level = ?,
        school_attending = ?, school_grade_level = ?,
        baptism_date = ?, baptism_church = ?,
        first_communion_date = ?, first_communion_church = ?, not_baptized = ?,
        sacramental_year = ?, preferred_class_time = ?, non_sacramental_grade = ?,
        disabilities_comments = ?, parent_signature = ?, email = ?,
        registration_fee = ?, sacramental_fee = ?, late_fee = ?,
        baptism_certificate_path = COALESCE(?, baptism_certificate_path),
        first_communion_certificate_path = COALESCE(?, first_communion_certificate_path),
        status = ?
      WHERE id = ? AND (user_id = ? OR ? = 1)
    `).run(
      `${req.body.primary_contact_first_name || ''} ${req.body.primary_contact_last_name || ''}`,
      orNull(req.body.primary_contact_first_name), orNull(req.body.primary_contact_last_name),
      orNull(req.body.primary_contact_phone), orNull(req.body.primary_contact_email), orNull(req.body.primary_contact_religion),
      orNull(req.body.primary_contact_relationship),
      req.body.primary_contact_relationship === 'Other' ? orNull(req.body.primary_contact_relationship_other) : null,
      orNull(req.body.address), `${req.body.city || ''}, ${req.body.state || ''} ${req.body.zip || ''}`, orNull(req.body.home_phone),
      orNull(req.body.father_name), orNull(req.body.father_religion), orNull(req.body.father_cell),
      orNull(req.body.mother_maiden_name), orNull(req.body.mother_religion), orNull(req.body.mother_cell),
      orNull(req.body.child_lives_with), orNull(req.body.step_parent_name), orNull(req.body.step_parent_religion),
      studentFullName, orNull(req.body.student_gender),
      orNull(req.body.student_dob), placeOfBirthLegacy, orNull(city), orNull(country), orNull(req.body.ccd_grade_level),
      orNull(req.body.school_attending), orNull(req.body.school_grade_level),
      req.body.not_baptized ? null : orNull(req.body.baptism_date), req.body.not_baptized ? null : orNull(req.body.baptism_church),
      req.body.not_baptized ? null : orNull(req.body.first_communion_date), req.body.not_baptized ? null : orNull(req.body.first_communion_church), req.body.not_baptized ? 1 : 0,
      req.body.sacramental_year || null, req.body.preferred_class_time || null, orNull(req.body.non_sacramental_grade),
      orNull(req.body.disabilities_comments), orNull(req.body.parent_signature), orNull(req.body.email),
      fees.registrationFee, fees.sacramentalFee, fees.lateFee,
      baptismCert, communionCert, nextStatus,
      req.body.registration_id, req.user.id, isAdmin ? 1 : 0
    );
    req.flash('success', 'Registration updated.');
    return res.redirect('/dashboard');
});

app.post(
  '/registration/children',
  requireAuth,
  certificateUpload.any(),
  normalizeCertificateUploads,
  handleChildrenRegistration
);

app.post('/registration/children/:id/status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  if (!STUDENT_REGISTRATION_STATUSES.includes(requestedStatus)) {
    req.flash('error', 'Invalid registration status.');
    return res.redirect(`/registration/children/edit/${req.params.id}`);
  }

  const reg = await db.prepare('SELECT * FROM student_registrations WHERE id = ?').get(req.params.id);
  if (!reg) {
    return res.status(404).send('Registration not found.');
  }

  if (requestedStatus === 'completed') {
    const missingFields = getIncompleteStudentRegistrationFields(reg);
    if (missingFields.length) {
      req.flash('error', `Cannot mark this registration completed until all required fields are filled in. Missing: ${missingFields.join(', ')}.`);
      return res.redirect(`/registration/children/edit/${req.params.id}`);
    }
  }

  await db.prepare('UPDATE student_registrations SET status = ? WHERE id = ?').run(requestedStatus, req.params.id);
  req.flash('success', res.locals.t('status_updated'));
  return res.redirect(`/registration/children/edit/${req.params.id}`);
}));

// GET /registration/children/edit/:id
app.get('/registration/children/edit/:id', requireAuth, asyncHandler(async (req, res) => {
  const faithFormationSettings = await requireRegistrationAccess(req, res, 'faith_formation');
  if (!faithFormationSettings) return;
  const isStaff = req.user.role === 'admin';
  const reg = await db.prepare('SELECT * FROM student_registrations WHERE id = ? AND (user_id = ? OR ? = 1)').get(req.params.id, req.user.id, isStaff ? 1 : 0);
  if (!reg) return res.status(404).send('Registration not found.');

  // Parse address back to city, state, zip
  const addressParts = reg.city_state_zip ? reg.city_state_zip.split(', ') : ['', '', ''];
  reg.city = addressParts[0] || '';
  reg.state = addressParts[1] ? addressParts[1].split(' ')[0] : '';
  reg.zip = addressParts[1] ? addressParts[1].split(' ')[1] : '';

  // Split parent_name into first and last if not already set
  if (!reg.primary_contact_first_name && reg.parent_name) {
    const parts = reg.parent_name.trim().split(' ');
    reg.primary_contact_first_name = parts[0] || '';
    reg.primary_contact_last_name = parts.slice(1).join(' ') || '';
  }

  // For simplicity, assume single child, but since it's array, need to handle multiple
  // But for now, render with the data
  const today = new Date().toISOString().slice(0, 10);
  res.render('registration-form', {
    editing: true,
    reg,
    today,
    isStaff,
    schoolYearLabel: `${res.locals.t('school_year')} ${reg.school_year || faithFormationSettings.schoolYear}`,
    activeSchoolYear: reg.school_year || faithFormationSettings.schoolYear,
    statusOptions: STUDENT_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['children', 'general']),
    ccdClasses: await getCcdClasses(),
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
  });
}));

// ── Adult Programs ───────────────────────────────────────────
app.get('/registration/family-faith', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    req.flash('error', 'Family Faith Formation registration is not open yet. Please check back later.');
    return res.redirect('/dashboard');
  }
  res.render('family-registration-form', {
    today: new Date().toISOString().slice(0, 10),
    reg: null,
    editing: false,
    isStaff: false,
    statusOptions: STUDENT_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['family_faith', 'general']),
    availableVisitSlots: (await getFamilyFaithVisitSlots()).map((slot) => ({ ...slot, label: formatVisitSlotLabel(slot) })),
    familyMemberRoleOptions: FAMILY_MEMBER_ROLE_OPTIONS,
    sacramentBadgeOptions: SACRAMENT_BADGE_OPTIONS,
  });
}));

app.post('/registration/family-faith', requireAuth, asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  const redirectUrl = req.body.registration_id
    ? `/registration/family-faith/edit/${req.body.registration_id}`
    : '/registration/family-faith';

  if (requestedStatus && !STUDENT_REGISTRATION_STATUSES.includes(requestedStatus)) {
    req.flash('error', 'Invalid registration status.');
    return res.redirect(redirectUrl);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (req.body.primary_contact_email && !emailRegex.test(req.body.primary_contact_email)) {
    req.flash('error', 'Invalid email format.');
    return res.redirect(redirectUrl);
  }

  const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
  if (req.body.primary_contact_phone && !phoneRegex.test(req.body.primary_contact_phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect(redirectUrl);
  }

  const members = parseFamilyMembersFromRequest(req.body.members_json);
  if (!req.body.family_name?.trim()) {
    req.flash('error', 'Family name is required.');
    return res.redirect(redirectUrl);
  }
  if (!req.body.primary_contact_name?.trim()) {
    req.flash('error', 'Primary contact name is required.');
    return res.redirect(redirectUrl);
  }
  if (!members.length) {
    req.flash('error', 'Please add at least one family member.');
    return res.redirect(redirectUrl);
  }
  if (members.some((member) => !member.firstName || !member.lastName)) {
    req.flash('error', 'Each family member must have a first and last name.');
    return res.redirect(redirectUrl);
  }

  const membersJson = JSON.stringify(members);
  const cityStateZip = `${req.body.city || ''}, ${req.body.state || ''} ${req.body.zip || ''}`.trim();
  const selectedVisitSlotId = Number(req.body.visit_slot_id || 0) || null;

  if (req.body.registration_id) {
    const existingReg = await db.prepare(
      'SELECT id, status, visit_slot_id FROM family_faith_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
    ).get(req.body.registration_id, req.user.id, isAdmin ? 1 : 0);
    if (!existingReg) return res.status(404).send('Registration not found.');

    const selectedVisitSlot = selectedVisitSlotId
      ? await db.prepare(`
          SELECT slots.id, slots.leader_user_id, slots.slot_start, slots.slot_end, slots.booked_registration_id,
                 users.full_name AS leader_name, users.email AS leader_email
          FROM family_faith_visit_slots slots
          INNER JOIN users ON users.id = slots.leader_user_id
          WHERE slots.id = ? AND (slots.booked_registration_id IS NULL OR slots.booked_registration_id = ?)
        `).get(selectedVisitSlotId, existingReg.id)
      : null;
    if (!selectedVisitSlot) {
      req.flash('error', res.locals.t('visit_slot_required'));
      return res.redirect(redirectUrl);
    }

    const nextStatus = isAdmin && requestedStatus ? requestedStatus : existingReg.status;
    await db.prepare(`
      UPDATE family_faith_registrations
      SET family_name = ?, primary_contact_name = ?, primary_contact_email = ?, primary_contact_phone = ?,
          address = ?, city_state_zip = ?, notes = ?, assigned_leader_user_id = ?, visit_slot_id = ?, visit_start = ?, visit_end = ?, visit_label = ?, members_json = ?, status = ?
      WHERE id = ? AND (user_id = ? OR ? = 1)
    `).run(
      req.body.family_name.trim(),
      req.body.primary_contact_name.trim(),
      req.body.primary_contact_email || null,
      req.body.primary_contact_phone || null,
      req.body.address || null,
      cityStateZip,
      req.body.notes || null,
      selectedVisitSlot.leader_user_id,
      selectedVisitSlot.id,
      selectedVisitSlot.slot_start,
      selectedVisitSlot.slot_end,
      formatVisitSlotLabel(selectedVisitSlot),
      membersJson,
      nextStatus,
      req.body.registration_id, req.user.id, isAdmin ? 1 : 0
    );
    if (existingReg.visit_slot_id && existingReg.visit_slot_id !== selectedVisitSlot.id) {
      await db.prepare('UPDATE family_faith_visit_slots SET booked_registration_id = NULL WHERE id = ?').run(existingReg.visit_slot_id);
    }
    await db.prepare('UPDATE family_faith_visit_slots SET booked_registration_id = ? WHERE id = ?').run(existingReg.id, selectedVisitSlot.id);
    req.flash('success', 'Family registration updated.');
    return res.redirect('/dashboard');
  }

  const selectedVisitSlot = selectedVisitSlotId
    ? await db.prepare(`
        SELECT slots.id, slots.leader_user_id, slots.slot_start, slots.slot_end, slots.booked_registration_id,
               users.full_name AS leader_name, users.email AS leader_email
        FROM family_faith_visit_slots slots
        INNER JOIN users ON users.id = slots.leader_user_id
        WHERE slots.id = ? AND slots.booked_registration_id IS NULL
      `).get(selectedVisitSlotId)
    : null;
  if (!selectedVisitSlot) {
    req.flash('error', res.locals.t('visit_slot_required'));
    return res.redirect(redirectUrl);
  }

  await db.prepare(`
    INSERT INTO family_faith_registrations
      (user_id, school_year, family_name, primary_contact_name, primary_contact_email, primary_contact_phone, address, city_state_zip, notes, assigned_leader_user_id, visit_slot_id, visit_start, visit_end, visit_label, members_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    req.body.school_year || '2025-2026',
    req.body.family_name.trim(),
    req.body.primary_contact_name.trim(),
    req.body.primary_contact_email || null,
    req.body.primary_contact_phone || null,
    req.body.address || null,
    cityStateZip,
    req.body.notes || null,
    selectedVisitSlot.leader_user_id,
    selectedVisitSlot.id,
    selectedVisitSlot.slot_start,
    selectedVisitSlot.slot_end,
    formatVisitSlotLabel(selectedVisitSlot),
    membersJson,
    'in_progress'
  );

  const insertedReg = await db.prepare('SELECT id FROM family_faith_registrations WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (insertedReg) {
    await db.prepare('UPDATE family_faith_visit_slots SET booked_registration_id = ? WHERE id = ?').run(insertedReg.id, selectedVisitSlot.id);
  }

  req.flash('success', 'Family faith formation registration submitted.');
  return res.redirect('/dashboard');
}));

app.post('/registration/family-faith/:id/status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  if (!STUDENT_REGISTRATION_STATUSES.includes(requestedStatus)) {
    req.flash('error', 'Invalid registration status.');
    return res.redirect(`/registration/family-faith/edit/${req.params.id}`);
  }

  const reg = await db.prepare('SELECT id FROM family_faith_registrations WHERE id = ?').get(req.params.id);
  if (!reg) return res.status(404).send('Registration not found.');

  await db.prepare('UPDATE family_faith_registrations SET status = ? WHERE id = ?').run(requestedStatus, req.params.id);
  req.flash('success', res.locals.t('status_updated'));
  return res.redirect(`/registration/family-faith/edit/${req.params.id}`);
}));

app.get('/registration/family-faith/edit/:id', requireAuth, asyncHandler(async (req, res) => {
  const isStaff = req.user.role === 'admin';
  const reg = await db.prepare(
    'SELECT * FROM family_faith_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
  ).get(req.params.id, req.user.id, isStaff ? 1 : 0);
  if (!reg) return res.status(404).send('Registration not found.');

  const addressParts = reg.city_state_zip ? reg.city_state_zip.split(', ') : ['', '', ''];
  reg.city = addressParts[0] || '';
  reg.state = addressParts[1] ? addressParts[1].split(' ')[0] : '';
  reg.zip = addressParts[1] ? addressParts[1].split(' ').slice(1).join(' ') : '';
  reg.members = parseFamilyMembersFromStorage(reg.members_json);
  const availableVisitSlots = (await getFamilyFaithVisitSlots({ includeBookedRegistrationId: reg.id }))
    .map((slot) => ({ ...slot, label: formatVisitSlotLabel(slot) }));

  res.render('family-registration-form', {
    today: new Date().toISOString().slice(0, 10),
    reg,
    editing: true,
    isStaff,
    statusOptions: STUDENT_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['family_faith', 'general']),
    availableVisitSlots,
    familyMemberRoleOptions: FAMILY_MEMBER_ROLE_OPTIONS,
    sacramentBadgeOptions: SACRAMENT_BADGE_OPTIONS,
  });
}));

// GET /registration/adult/:program  (ocia | baptism_prep | adult_confirmation)
app.get('/registration/adult/:program', requireAuth, asyncHandler(async (req, res) => {
  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  const program = ADULT_PROGRAMS[req.params.program];
  if (!program) return res.status(404).send('Unknown program.');
  res.render('adult-registration-form', {
    program,
    reg: null,
    editing: false,
    baptismPrepSchedules: await getBaptismPrepSchedules(),
    relevantEvents: await getFaithFormationEvents([program.key, 'general']),
  });
}));

// GET /registration/adult/edit/:program/:id
app.get('/registration/adult/edit/:program/:id', requireAuth, asyncHandler(async (req, res) => {
  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  const program = ADULT_PROGRAMS[req.params.program];
  if (!program) return res.status(404).send('Unknown program.');
  const isAdmin = req.user.role === 'admin';

  const reg = await db.prepare(
    'SELECT * FROM adult_registrations WHERE id = ? AND (user_id = ? OR ? = 1) AND program_type = ?'
  ).get(req.params.id, req.user.id, isAdmin ? 1 : 0, req.params.program);
  if (!reg) return res.status(404).send('Registration not found.');

  // Parse address
  const addressParts = reg.city_state_zip ? reg.city_state_zip.split(', ') : ['', '', ''];
  reg.city = addressParts[0] || '';
  reg.state = addressParts[1] ? addressParts[1].split(' ')[0] : '';
  reg.zip = addressParts[1] ? addressParts[1].split(' ')[1] : '';

  res.render('adult-registration-form', {
    program,
    editing: true,
    reg,
    baptismPrepSchedules: await getBaptismPrepSchedules(),
    relevantEvents: await getFaithFormationEvents([program.key, 'general']),
  });
}));

app.post('/registration/adult/:program', requireAuth, asyncHandler(async (req, res) => {
  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  const program = ADULT_PROGRAMS[req.params.program];
  if (!program) return res.status(404).send('Unknown program.');
  const orNull = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  const city = typeof req.body.city === 'string' ? req.body.city.trim() : '';
  const stateZip = [req.body.state, req.body.zip]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(' ');
  const cityStateZip = city && stateZip ? `${city}, ${stateZip}` : (city || stateZip || null);
  const redirectUrl = req.body.registration_id
    ? `/registration/adult/edit/${program.key}/${req.body.registration_id}`
    : `/registration/adult/${program.key}`;

  // Server-side validation
  if (program.key === 'ocia') {
    const requiredFields = [
      ['full_name', 'Full name'],
      ['email', 'Email'],
      ['phone', 'Phone'],
      ['dob', 'Date of birth'],
      ['baptized', 'Baptism status'],
      ['address', 'Address'],
      ['city', 'City'],
      ['state', 'State'],
      ['zip', 'ZIP code'],
    ];
    const missingFields = requiredFields
      .filter(([field]) => typeof req.body[field] !== 'string' || !req.body[field].trim())
      .map(([, label]) => label);
    if (missingFields.length) {
      req.flash('error', `Please complete all required fields: ${missingFields.join(', ')}.`);
      return res.redirect(redirectUrl);
    }
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (req.body.email && !emailRegex.test(req.body.email)) {
    req.flash('error', 'Invalid email format.');
    return res.redirect(redirectUrl);
  }
  const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
  if (req.body.phone && !phoneRegex.test(req.body.phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect(redirectUrl);
  }
  const selectedClassScheduleId = Number(req.body.class_schedule_id);
  let selectedBaptismPrepSchedule = null;
  if (program.key === 'baptism_prep') {
    selectedBaptismPrepSchedule = Number.isInteger(selectedClassScheduleId) && selectedClassScheduleId > 0
      ? await db.prepare(
          `SELECT schedules.id, definitions.audience, definitions.title, schedules.schedule_type, schedules.recurrence_pattern,
                  schedules.event_date, schedules.event_time, schedules.event_end_time, schedules.location
           FROM faith_formation_event_schedules schedules
           INNER JOIN faith_formation_event_definitions definitions
             ON definitions.id = schedules.event_definition_id
           WHERE schedules.id = ? AND definitions.audience = 'baptism_prep'`
        ).get(selectedClassScheduleId)
      : null;
    if (!selectedBaptismPrepSchedule) {
      req.flash('error', 'Please select an available Baptism Preparation class date.');
      return res.redirect(redirectUrl);
    }
  }

  if (req.body.registration_id) {
    const isAdmin = req.user.role === 'admin';
    // Update existing
    await db.prepare(`
      UPDATE adult_registrations SET
        full_name = ?, email = ?, phone = ?, address = ?, city_state_zip = ?,
        dob = ?, baptized = ?, baptism_church = ?, spouse_name = ?, godparent_for = ?, comments = ?, class_schedule_id = ?, class_date = ?
      WHERE id = ? AND (user_id = ? OR ? = 1) AND program_type = ?
    `).run(
      orNull(req.body.full_name),
      orNull(req.body.email),
      orNull(req.body.phone),
      orNull(req.body.address),
      cityStateZip,
      orNull(req.body.dob),
      orNull(req.body.baptized),
      orNull(req.body.baptism_church),
      orNull(req.body.spouse_name),
      orNull(req.body.godparent_for),
      orNull(req.body.comments),
      program.key === 'baptism_prep' ? selectedClassScheduleId : null,
      program.key === 'baptism_prep' && selectedBaptismPrepSchedule ? formatScheduledEventLabel(selectedBaptismPrepSchedule) : null,
      req.body.registration_id, req.user.id, isAdmin ? 1 : 0, program.key
    );
    req.flash('success', 'Registration updated.');
    return res.redirect('/dashboard');
  }

  await db.prepare(`
    INSERT INTO adult_registrations
      (user_id, program_type, full_name, email, phone, address, city_state_zip,
       dob, baptized, baptism_church, spouse_name, godparent_for, comments, class_schedule_id, class_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    program.key,
    orNull(req.body.full_name),
    orNull(req.body.email),
    orNull(req.body.phone),
    orNull(req.body.address),
    cityStateZip,
    orNull(req.body.dob),
    orNull(req.body.baptized),
    orNull(req.body.baptism_church),
    orNull(req.body.spouse_name),
    orNull(req.body.godparent_for),
    orNull(req.body.comments),
    program.key === 'baptism_prep' ? selectedClassScheduleId : null,
    program.key === 'baptism_prep' && selectedBaptismPrepSchedule ? formatScheduledEventLabel(selectedBaptismPrepSchedule) : null,
    'in_progress',
  );

  req.flash('success', `Your ${program.title} registration has been submitted. The parish office will be in touch.`);
  return res.redirect('/dashboard');
}));

// ── Admin ────────────────────────────────────────────────────
app.get('/admin', requireAuth, requireRole('admin'), (req, res) => res.redirect('/admin/registrations'));

app.post('/admin/registrations/children/:id/archive', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('UPDATE student_registrations SET archived_at = NOW() WHERE id = ?').run(req.params.id);
  req.flash('success', 'Registration archived.');
  return res.redirect('/admin/registrations');
}));

app.post('/admin/registrations/children/:id/unarchive', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('UPDATE student_registrations SET archived_at = NULL WHERE id = ?').run(req.params.id);
  req.flash('success', 'Registration restored.');
  return res.redirect('/admin/registrations');
}));

app.post('/admin/registrations/children/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const registration = await db.prepare('SELECT student_full_name FROM student_registrations WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM student_registrations WHERE id = ?').run(req.params.id);
  req.flash('success', `Deleted registration for ${registration ? registration.student_full_name : 'that student'}.`);
  return res.redirect('/admin/registrations');
}));

app.post('/admin/registrations/adult/:id/archive', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('UPDATE adult_registrations SET archived_at = NOW() WHERE id = ?').run(req.params.id);
  req.flash('success', 'Registration archived.');
  return res.redirect('/admin/registrations');
}));

app.post('/admin/registrations/adult/:id/unarchive', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('UPDATE adult_registrations SET archived_at = NULL WHERE id = ?').run(req.params.id);
  req.flash('success', 'Registration restored.');
  return res.redirect('/admin/registrations');
}));

app.post('/admin/registrations/adult/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const registration = await db.prepare('SELECT full_name FROM adult_registrations WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM adult_registrations WHERE id = ?').run(req.params.id);
  req.flash('success', `Deleted registration for ${registration ? registration.full_name : 'that person'}.`);
  return res.redirect('/admin/registrations');
}));

const VERIFICATION_FIELDS = new Set(['certificates_verified', 'tuition_paid', 'parent_contacted']);

app.post('/admin/registrations/children/:id/verification', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const registrationId = Number.parseInt(req.params.id, 10);
  const field = req.body.field;
  const checked = req.body.checked === 'true' || req.body.checked === true;

  if (!Number.isInteger(registrationId) || !VERIFICATION_FIELDS.has(field)) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }

  const registration = await db.prepare('SELECT id FROM student_registrations WHERE id = ?').get(registrationId);
  if (!registration) {
    return res.status(404).json({ ok: false, error: 'Registration not found.' });
  }

  const atCol = `${field}_at`;
  const byCol = `${field}_by`;

  if (checked) {
    await db.prepare(
      `UPDATE student_registrations SET \`${field}\` = 1, \`${atCol}\` = CURRENT_TIMESTAMP, \`${byCol}\` = ? WHERE id = ?`
    ).run(req.user.id, registrationId);
  } else {
    await db.prepare(
      `UPDATE student_registrations SET \`${field}\` = 0, \`${atCol}\` = NULL, \`${byCol}\` = NULL WHERE id = ?`
    ).run(registrationId);
  }

  const updated = await db.prepare(
    `SELECT \`${field}\` AS checked, \`${atCol}\` AS at, \`${byCol}\` AS byId FROM student_registrations WHERE id = ?`
  ).get(registrationId);

  const verifierName = updated.byId ? (req.user.full_name || req.user.email) : null;

  return res.json({
    ok: true,
    field,
    checked: !!updated.checked,
    at: updated.at,
    verifierName,
  });
}));

const csvCell = (value) => {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet applications from interpreting submitted text as a formula.
  if (/^[\t\r\n\v\f ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const summarizeFamilyMembers = (membersJson) => parseFamilyMembersFromStorage(membersJson)
  .map((member) => {
    const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Unnamed';
    const details = [member.role, member.dob ? `DOB ${member.dob}` : ''].filter(Boolean).join(', ');
    return details ? `${name} (${details})` : name;
  })
  .join('; ');

app.get('/admin/registrations/export.csv', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const gradeFilter = Object.keys(CCD_GRADE_MEANINGS).includes(req.query.grade) ? req.query.grade : '';
  const parentFilter = typeof req.query.parent === 'string' ? req.query.parent.trim() : '';

  const [studentRegsAll, familyRegs, adultRegs, sponsorRegs] = await Promise.all([
    db.prepare('SELECT * FROM student_registrations ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM family_faith_registrations ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM adult_registrations ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM sponsor_confirmations ORDER BY created_at DESC').all(),
  ]);
  const studentRegs = studentRegsAll.filter((reg) => {
    if (gradeFilter && resolveCcdGrade(reg) !== gradeFilter) return false;
    if (parentFilter) {
      const needle = parentFilter.toLowerCase();
      const haystack = `${reg.parent_name || ''} ${reg.primary_contact_email || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const verifierUserIds = new Set();
  studentRegs.forEach((reg) => {
    ['certificates_verified_by', 'tuition_paid_by', 'parent_contacted_by'].forEach((col) => {
      if (reg[col]) verifierUserIds.add(Number(reg[col]));
    });
  });
  let verifierLookup = {};
  if (verifierUserIds.size > 0) {
    const ids = [...verifierUserIds];
    const verifierRows = await db.prepare(
      `SELECT id, full_name, email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids);
    verifierLookup = Object.fromEntries(verifierRows.map((row) => [row.id, row.full_name || row.email]));
  }
  const resolveVerifier = (userId) => (userId ? (verifierLookup[Number(userId)] || userId) : userId);

  const rows = [
    ...studentRegs.map((registration) => ({
      registration_type: 'child',
      ...registration,
      certificates_verified_by: resolveVerifier(registration.certificates_verified_by),
      tuition_paid_by: resolveVerifier(registration.tuition_paid_by),
      parent_contacted_by: resolveVerifier(registration.parent_contacted_by),
    })),
    ...familyRegs.map(({ members_json, ...registration }) => ({
      registration_type: 'family_faith',
      ...registration,
      family_members: summarizeFamilyMembers(members_json),
    })),
    ...adultRegs.map((registration) => ({ registration_type: 'adult', ...registration })),
    ...sponsorRegs.map((registration) => ({ registration_type: 'sponsor_confirmation', ...registration })),
  ];
  const headers = ['registration_type'];
  const seenHeaders = new Set(headers);
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seenHeaders.has(key)) {
        seenHeaders.add(key);
        headers.push(key);
      }
    });
  });
  const dateStamp = new Date().toISOString().slice(0, 10);

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="registrations-${dateStamp}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.write(`\uFEFF${headers.map(csvCell).join(',')}`);
  rows.forEach((row) => {
    res.write(`\r\n${headers.map((header) => csvCell(row[header])).join(',')}`);
  });
  return res.end();
}));

app.get('/admin/registrations', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const faithFormationSettings = await getFaithFormationSettings();

  const gradeFilter = Object.keys(CCD_GRADE_MEANINGS).includes(req.query.grade) ? req.query.grade : '';
  const parentFilter = typeof req.query.parent === 'string' ? req.query.parent.trim() : '';

  const studentRegsAll = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL ORDER BY created_at DESC').all();
  const studentRegs = studentRegsAll.filter((reg) => {
    if (gradeFilter && resolveCcdGrade(reg) !== gradeFilter) return false;
    if (parentFilter) {
      const needle = parentFilter.toLowerCase();
      const haystack = `${reg.parent_name || ''} ${reg.primary_contact_email || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  const archivedStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all();

  const familyRegsRaw = await db.prepare('SELECT * FROM family_faith_registrations ORDER BY created_at DESC').all();
  const familyRegs = familyRegsRaw.map((reg) => ({
    ...reg,
    members: parseFamilyMembersFromStorage(reg.members_json),
  }));

  const adultRegs = await db.prepare('SELECT * FROM adult_registrations WHERE archived_at IS NULL ORDER BY created_at DESC').all();
  const archivedAdultRegs = await db.prepare('SELECT * FROM adult_registrations WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all();
  const sponsorRegs = await db.prepare('SELECT * FROM sponsor_confirmations ORDER BY created_at DESC').all();

  const verifierUserIds = new Set();
  [...studentRegs, ...archivedStudentRegs].forEach((reg) => {
    ['certificates_verified_by', 'tuition_paid_by', 'parent_contacted_by'].forEach((col) => {
      if (reg[col]) verifierUserIds.add(Number(reg[col]));
    });
  });
  let verifierLookup = {};
  if (verifierUserIds.size > 0) {
    const ids = [...verifierUserIds];
    const verifierRows = await db.prepare(
      `SELECT id, full_name, email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids);
    verifierLookup = Object.fromEntries(verifierRows.map((row) => [row.id, row.full_name || row.email]));
  }

  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  res.render('admin-registrations', {
    studentRegs, archivedStudentRegs, familyRegs, adultRegs, archivedAdultRegs, sponsorRegs, ADULT_PROGRAMS, faithFormationSettings,
    resolveCcdGrade, ccdGradeMeanings: CCD_GRADE_MEANINGS, gradeFilter, parentFilter, verifierLookup,
  });
}));

app.get('/admin/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const validRoles = ['user', 'catechist', 'family_faith_leader', 'admin'];
  const roleFilter = validRoles.includes(req.query.role) ? req.query.role : '';
  const users = await db.prepare(`
    SELECT id, email, role, provider, full_name, phone, is_active, account_status, email_verified_at, created_at
    FROM users
    ${roleFilter ? 'WHERE role = ?' : ''}
    ORDER BY created_at DESC
  `).all(...(roleFilter ? [roleFilter] : []));
  const adorationSignups = await db.prepare(`
    SELECT id, full_name, email, phone, adoration_date, slot_start_time, slot_end_time, notes, created_at
    FROM eucharistic_adoration_signups
    ORDER BY adoration_date ASC, slot_start_time ASC, created_at ASC
  `).all();
  const adorationAvailableDates = await getAvailableAdorationDates({ includePast: true });
  const ccdClasses = await getCcdClasses();
  const catechists = await getCatechists();
  const eventDefinitions = await getFaithFormationEventDefinitions();
  const managedEvents = await getFaithFormationEvents(['children', 'family_faith', 'baptism_prep', 'ocia', 'general'], { includePast: true });
  const faithFormationSettings = await getFaithFormationSettings();
  const registrationYearStatuses = await getRegistrationYearStatusList(parseFaithFormationStartYear(faithFormationSettings.currentRegistrationYear));
  const altarServerTrainingDates = await getAltarServerTrainingDates({ includePast: true });
  const altarServerSignups = await db.prepare(`
    SELECT s.id, s.child_first_name, s.child_last_name, s.child_dob, s.child_grade,
           s.parent_name, s.parent_email, s.parent_phone, s.notes, s.status, s.created_at,
           t.training_date, t.training_time, t.location AS training_location
    FROM altar_server_signups s
    LEFT JOIN altar_server_training_dates t ON t.id = s.training_date_id
    ORDER BY s.created_at DESC
  `).all();
  res.render('admin-users', {
    users,
    roleFilter,
    adorationSignups,
    adorationAvailableDates,
    formatAdorationDateLabel,
    formatTimeLabel,
    ccdClasses,
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
    catechists,
    eventDefinitions,
    managedEvents,
    faithFormationSettings,
    registrationYearOptions: getRegistrationYearOptions(parseFaithFormationStartYear(faithFormationSettings.schoolYear)),
    registrationYearStatuses,
    altarServerTrainingDates,
    altarServerSignups,
  });
}));

app.get('/admin/users/:id/registrations', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user.');
    return res.redirect('/admin/users');
  }

  const targetUser = await db.prepare(`
    SELECT id, email, role, provider, full_name, phone, is_active, email_verified_at, created_at
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!targetUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  const studentRegs = await db.prepare(`
    SELECT *
    FROM student_registrations
    WHERE user_id = ?
    ORDER BY archived_at IS NULL DESC, created_at DESC
  `).all(userId);
  const familyRegsRaw = await db.prepare(`
    SELECT *
    FROM family_faith_registrations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  const familyRegs = familyRegsRaw.map((reg) => ({
    ...reg,
    members: parseFamilyMembersFromStorage(reg.members_json),
  }));
  const adultRegs = await db.prepare(`
    SELECT *
    FROM adult_registrations
    WHERE user_id = ?
    ORDER BY archived_at IS NULL DESC, created_at DESC
  `).all(userId);
  const sponsorRegs = await db.prepare(`
    SELECT *
    FROM sponsor_confirmations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

  res.render('admin-user-registrations', {
    targetUser,
    studentRegs,
    familyRegs,
    adultRegs,
    sponsorRegs,
    ADULT_PROGRAMS: getAdultPrograms(res.locals.t),
    resolveCcdGrade,
  });
}));

app.get('/admin/users/:id/uploads', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user.');
    return res.redirect('/admin/users');
  }

  const targetUser = await db.prepare(`
    SELECT id, email, role, provider, full_name, phone, is_active, email_verified_at, created_at
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!targetUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  const uploads = await getUploadsForUser(userId);
  res.render('account-uploads', { uploads, targetUser, adminView: true });
}));

app.post('/admin/eucharistic-adoration/dates', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const adorationDate = typeof req.body.adoration_date === 'string' ? req.body.adoration_date.trim() : '';
  const startTime = typeof req.body.start_time === 'string' ? req.body.start_time.trim() : '';
  const endTime = typeof req.body.end_time === 'string' ? req.body.end_time.trim() : '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(adorationDate)) {
    req.flash('error', 'Please choose a valid Eucharistic Adoration date.');
    return res.redirect('/admin/users');
  }

  if (adorationDate < getTodayDateValue()) {
    req.flash('error', 'Please choose today or a future date for Eucharistic Adoration.');
    return res.redirect('/admin/users');
  }

  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    req.flash('error', 'Please choose a valid start and end time for Eucharistic Adoration.');
    return res.redirect('/admin/users');
  }

  const configuredSlots = getEucharisticAdorationSlots({ startTime, endTime });
  if (!configuredSlots.length) {
    req.flash('error', 'Please choose a time range that allows at least one 1-hour adoration slot.');
    return res.redirect('/admin/users');
  }

  try {
    await db.prepare(`
      INSERT INTO eucharistic_adoration_available_dates (adoration_date, start_time, end_time)
      VALUES (?, ?, ?)
    `).run(adorationDate, startTime, endTime);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      req.flash('error', `Eucharistic Adoration is already available on ${formatAdorationDateLabel(adorationDate)}.`);
      return res.redirect('/admin/users');
    }
    throw error;
  }

  req.flash('success', `Eucharistic Adoration is now open on ${formatAdorationDateLabel(adorationDate)} from ${formatTimeLabel(startTime)} to ${formatTimeLabel(endTime)}.`);
  return res.redirect('/admin/users');
}));

app.post('/admin/eucharistic-adoration/dates/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const dateId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(dateId)) {
    req.flash('error', 'Invalid Eucharistic Adoration date.');
    return res.redirect('/admin/users');
  }

  const existingDate = await db.prepare(`
    SELECT id, adoration_date, start_time, end_time
    FROM eucharistic_adoration_available_dates
    WHERE id = ?
  `).get(dateId);
  if (!existingDate) {
    req.flash('error', 'Eucharistic Adoration date not found.');
    return res.redirect('/admin/users');
  }

  await db.prepare('DELETE FROM eucharistic_adoration_available_dates WHERE id = ?').run(dateId);
  req.flash('success', `Removed availability for ${formatAdorationDateLabel(existingDate.adoration_date)}.`);
  return res.redirect('/admin/users');
}));

app.post('/admin/eucharistic-adoration/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const signupId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(signupId)) {
    req.flash('error', 'Invalid Eucharistic Adoration signup.');
    return res.redirect('/admin/users');
  }

  const existingSignup = await db.prepare('SELECT id FROM eucharistic_adoration_signups WHERE id = ?').get(signupId);
  if (!existingSignup) {
    req.flash('error', 'Eucharistic Adoration signup not found.');
    return res.redirect('/admin/users');
  }

  await db.prepare('DELETE FROM eucharistic_adoration_signups WHERE id = ?').run(signupId);
  req.flash('success', 'Eucharistic Adoration signup removed.');
  return res.redirect('/admin/users');
}));

app.post('/admin/settings/faith-formation', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const schoolYear = typeof req.body.current_registration_year === 'string' && req.body.current_registration_year.trim()
    ? req.body.current_registration_year.trim()
    : '';

  if (!/^\d{4}-\d{4}$/.test(schoolYear)) {
    req.flash('error', 'Current registration year must use YYYY-YYYY format.');
    return res.redirect('/admin/users');
  }

  const [startYear, endYear] = schoolYear.split('-').map(Number);
  if (endYear !== startYear + 1) {
    req.flash('error', 'Current registration year must span consecutive years, such as 2026-2027.');
    return res.redirect('/admin/users');
  }

  await db.prepare(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`
  ).run('current_registration_year', schoolYear);

  await db.prepare(
    `INSERT INTO registration_year_settings (school_year, faith_formation_open, sponsor_form_open)
     VALUES (?, 0, 0)
     ON DUPLICATE KEY UPDATE school_year = VALUES(school_year)`
  ).run(schoolYear);

  req.flash('success', `Current registration year set to ${schoolYear}.`);
  return res.redirect('/admin/users');
}));

app.post('/admin/settings/faith-formation/year', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const schoolYear = typeof req.body.school_year === 'string' ? req.body.school_year.trim() : '';
  const faithFormationRegistrationOpen = req.body.faith_formation_registration_open === '1' ? 1 : 0;
  const sponsorFormRegistrationOpen = req.body.sponsor_form_registration_open === '1' ? 1 : 0;

  if (!/^\d{4}-\d{4}$/.test(schoolYear)) {
    req.flash('error', 'Registration year must use YYYY-YYYY format.');
    return res.redirect('/admin/users');
  }

  const [startYear, endYear] = schoolYear.split('-').map(Number);
  if (endYear !== startYear + 1) {
    req.flash('error', 'Registration year must span consecutive years, such as 2026-2027.');
    return res.redirect('/admin/users');
  }

  await db.prepare(
    `INSERT INTO registration_year_settings (school_year, faith_formation_open, sponsor_form_open)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       faith_formation_open = VALUES(faith_formation_open),
       sponsor_form_open = VALUES(sponsor_form_open)`
  ).run(schoolYear, faithFormationRegistrationOpen, sponsorFormRegistrationOpen);

  req.flash('success', `${schoolYear} updated. Faith Formation is ${faithFormationRegistrationOpen ? 'open' : 'closed'}, Sponsor Form is ${sponsorFormRegistrationOpen ? 'open' : 'closed'}.`);
  return res.redirect('/admin/users');
}));

app.get('/admin/scan-registration', requireAuth, requireRole('admin'), (req, res) => {
  getFaithFormationSettings()
    .then((faithFormationSettings) => res.render('admin-scan-registration', { faithFormationSettings }))
    .catch((error) => {
      console.error('Unable to load Faith Formation settings for scan registration.', error);
      res.render('admin-scan-registration', {
        faithFormationSettings: { schoolYear: getDefaultFaithFormationYear() },
      });
    });
});

app.post('/admin/scan-registration/process', requireAuth, requireRole('admin'), scanUpload.single('scan_image'), asyncHandler(async (req, res) => {
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ ok: false, message: 'No scan image was uploaded.' });
  }

  const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  if (!allowedMimeTypes.has(req.file.mimetype)) {
    return res.status(400).json({ ok: false, message: 'Unsupported scan file type.' });
  }

  try {
    const result = await processScanDocument({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    return res.json({
      ok: true,
      text: result.text,
      formFields: result.formFields,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error?.message || 'Unable to process the scanned document.',
      code: error?.code || null,
    });
  }
}));

app.post('/admin/users/create', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const allowedRoles = new Set(['user', 'catechist', 'family_faith_leader', 'admin']);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const role = allowedRoles.has(req.body.role) ? req.body.role : 'user';

  if (!fullName || !email) {
    req.flash('error', 'Full name and email are required to create a user.');
    return res.redirect('/admin/users');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    req.flash('error', 'Please enter a valid email address.');
    return res.redirect('/admin/users');
  }
  if (phone && !phoneRegex.test(phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect('/admin/users');
  }

  const existing = await db.prepare('SELECT id, account_status FROM users WHERE email = ?').get(email);
  if (existing && !db.isDeletedAccount(existing)) {
    req.flash('error', `An account already exists for ${email}.`);
    return res.redirect('/admin/users');
  }

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);

  if (existing) {
    // A previously deleted account reusing this email: reactivate the row in place
    // rather than inserting a new one, since email stays UNIQUE across the table.
    await db.prepare(`
      UPDATE users
      SET password_hash = ?, role = ?, provider = 'local', full_name = ?, first_name = ?, last_name = ?, phone = ?,
          is_active = 1, account_status = 'active', email_verified_at = CURRENT_TIMESTAMP,
          email_verification_token = NULL, email_verification_expires_at = NULL,
          password_reset_token = NULL, password_reset_expires_at = NULL, must_change_password = 1
      WHERE id = ?
    `).run(passwordHash, role, fullName, firstName, lastName, phone || null, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO users (
        email, password_hash, role, provider, full_name, first_name, last_name, phone, is_active, email_verified_at, must_change_password
      ) VALUES (?, ?, ?, 'local', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, 1)
    `).run(email, passwordHash, role, fullName, firstName, lastName, phone || null);
  }

  const loginUrl = `${getBaseUrl(req)}/login`;

  let delivery;
  try {
    delivery = await sendTemporaryPasswordEmail({ to: email, tempPassword, loginUrl, fullName });
  } catch (error) {
    console.error('[admin] Temporary password email failed', {
      email,
      message: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
      responseCode: error?.responseCode || null,
    });
    req.flash('error', `Account created for ${email}, but the email could not be sent. Temporary password: ${tempPassword}`);
    return res.redirect('/admin/users');
  }

  if (delivery.delivered) {
    req.flash('success', `Account created and temporary password emailed to ${email}.`);
  } else {
    req.flash('success', `Account created for ${email}. Temporary password (email not sent): ${tempPassword}`);
  }
  return res.redirect('/admin/users');
}));

app.post('/admin/users/catechists', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

  if (!fullName || !email) {
    req.flash('error', 'Full name and email are required to invite a catechist.');
    return res.redirect('/admin/users');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    req.flash('error', 'Please enter a valid email address.');
    return res.redirect('/admin/users');
  }
  if (phone && !phoneRegex.test(phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect('/admin/users');
  }

  const existing = await db.prepare('SELECT id, account_status FROM users WHERE email = ?').get(email);
  if (existing && !db.isDeletedAccount(existing)) {
    req.flash('error', `An account already exists for ${email}.`);
    return res.redirect('/admin/users');
  }

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  if (existing) {
    // A previously deleted account reusing this email: reactivate the row in place
    // rather than inserting a new one, since email stays UNIQUE across the table.
    await db.prepare(`
      UPDATE users
      SET password_hash = NULL, role = 'catechist', provider = 'local', full_name = ?, first_name = ?, last_name = ?, phone = ?,
          is_active = 0, account_status = 'active', email_verified_at = NULL,
          email_verification_token = NULL, email_verification_expires_at = NULL
      WHERE id = ?
    `).run(fullName, firstName, lastName, phone || null, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO users (
        email, password_hash, role, provider, full_name, first_name, last_name, phone, is_active
      ) VALUES (?, NULL, 'catechist', 'local', ?, ?, ?, ?, 0)
    `).run(email, fullName, firstName, lastName, phone || null);
  }

  const newUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  const invitationToken = createVerificationToken();
  const invitationTokenHash = hashVerificationToken(invitationToken);
  const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?
  `).run(invitationTokenHash, invitationExpiresAt, newUser.id);

  const activationUrl = `${getBaseUrl(req)}/reset-password?token=${invitationToken}`;

  let delivery;
  try {
    delivery = await sendCatechistInvitationEmail({ to: email, activationUrl, fullName });
  } catch (error) {
    console.error('[admin] Catechist invitation email failed', {
      email,
      message: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
      responseCode: error?.responseCode || null,
    });
    req.flash('error', `Catechist account created, but the invitation email could not be sent to ${email}.`);
    return res.redirect('/admin/users');
  }

  if (delivery.delivered) {
    req.flash('success', `Catechist account created and invitation sent to ${email}.`);
  } else if (process.env.NODE_ENV !== 'production') {
    req.flash('success', `Catechist account created (dev preview, email not sent): ${activationUrl}`);
  } else {
    req.flash('error', `Catechist account created, but the invitation email could not be sent to ${email}.`);
  }
  return res.redirect('/admin/users');
}));

app.post('/admin/users/:id/role', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const allowedRoles = new Set(['user', 'catechist', 'family_faith_leader', 'admin']);
  if (!allowedRoles.has(req.body.role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect('/admin/users');
  }
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, req.params.id);
  req.flash('success', 'User role updated.');
  res.redirect('/admin/users');
}));

app.get('/admin/health/mail', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await verifyMailConfiguration();
    console.info('[admin] Mail health check completed', result);
    return res.status(result.ok ? 200 : 500).json({
      checkedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    const failure = {
      checkedAt: new Date().toISOString(),
      ok: false,
      config: smtpLogConfig,
      message: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
      responseCode: error?.responseCode || null,
    };
    console.error('[admin] Mail health check failed', failure);
    return res.status(500).json(failure);
  }
});

app.get('/admin/health/document-ai', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await verifyDocumentAiConfiguration();
    return res.status(result.ok ? 200 : 500).json({
      checkedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      checkedAt: new Date().toISOString(),
      ok: false,
      message: error?.message || String(error),
      code: error?.code || null,
    });
  }
});

app.get('/admin/users/:id/verification-email', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).send('Invalid user.');
  }

  const targetUser = await db.prepare(`
    SELECT id, email, full_name, provider, is_active, account_status
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!targetUser) {
    return res.status(404).send('User not found.');
  }
  if (targetUser.provider !== 'local') {
    return res.status(400).send('Verification email preview is only available for local accounts.');
  }
  if (db.isDeletedAccount(targetUser)) {
    return res.status(400).send('This account has been deleted.');
  }
  if (targetUser.is_active) {
    return res.status(400).send('This account is already active.');
  }

  const verificationUrl = `${getBaseUrl(req)}/verify-email?token=[token-hidden]`;
  const emailPreview = buildVerificationEmailContent({
    verificationUrl,
    fullName: targetUser.full_name || '',
  });

  return res.render('admin-email-preview', {
    targetUser,
    verificationUrl,
    emailPreview,
  });
}));

app.post('/admin/users/:id/resend-verification', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user.');
    return res.redirect('/admin/users');
  }

  const targetUser = await db.prepare(`
    SELECT id, email, full_name, role, provider, is_active, account_status
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!targetUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  if (targetUser.provider !== 'local') {
    req.flash('error', 'Only local accounts use verification emails.');
    return res.redirect('/admin/users');
  }
  if (db.isDeletedAccount(targetUser)) {
    req.flash('error', 'This account has been deleted.');
    return res.redirect('/admin/users');
  }
  if (targetUser.is_active) {
    req.flash('error', 'This account is already active.');
    return res.redirect('/admin/users');
  }

  let delivery;
  try {
    ({ delivery } = await issueVerificationForUser({
      userId: targetUser.id,
      email: targetUser.email,
      fullName: targetUser.full_name || '',
      role: targetUser.role,
      req,
    }));
  } catch (error) {
    console.error('[admin] Resend verification failed', {
      email: targetUser.email,
      message: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
      responseCode: error?.responseCode || null,
    });
    req.flash('error', `Unable to resend verification email to ${targetUser.email}.`);
    return res.redirect('/admin/users');
  }

  req.flash(
    delivery.delivered
      ? 'success'
      : 'error',
    delivery.delivered
      ? `Verification email resent to ${targetUser.email}.`
      : `Verification email could not be sent to ${targetUser.email}.`
  );
  return res.redirect('/admin/users');
}));

app.post('/admin/users/:id/reset-password', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user.');
    return res.redirect('/admin/users');
  }

  const targetUser = await db.prepare('SELECT id, email, full_name, provider, account_status FROM users WHERE id = ?').get(userId);
  if (!targetUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  if (targetUser.provider !== 'local') {
    req.flash('error', 'Only local accounts have a password to reset.');
    return res.redirect('/admin/users');
  }
  if (db.isDeletedAccount(targetUser)) {
    req.flash('error', 'This account has been deleted.');
    return res.redirect('/admin/users');
  }

  const resetToken = createVerificationToken();
  const resetTokenHash = hashVerificationToken(resetToken);
  const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.prepare(`UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?`).run(resetTokenHash, resetExpiresAt, targetUser.id);
  const resetUrl = `${getBaseUrl(req)}/reset-password?token=${resetToken}`;

  let delivery;
  try {
    delivery = await sendPasswordResetEmail({ to: targetUser.email, resetUrl, fullName: targetUser.full_name || '' });
  } catch (error) {
    console.error('[admin] Password reset email failed', {
      email: targetUser.email,
      message: error?.message || String(error),
      code: error?.code || null,
      response: error?.response || null,
      responseCode: error?.responseCode || null,
    });
    req.flash('error', `Unable to send password reset email to ${targetUser.email}.`);
    return res.redirect('/admin/users');
  }

  if (delivery.delivered) {
    req.flash('success', `Password reset email sent to ${targetUser.email}.`);
  } else if (process.env.NODE_ENV !== 'production') {
    req.flash('success', `Password reset link (dev preview, email not sent): ${resetUrl}`);
  } else {
    req.flash('error', `Password reset email could not be sent to ${targetUser.email}.`);
  }
  return res.redirect('/admin/users');
}));

app.post('/admin/users/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user.');
    return res.redirect('/admin/users');
  }

  if (req.user.id === userId) {
    req.flash('error', 'You cannot delete your own account.');
    return res.redirect('/admin/users');
  }

  const existingUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
  if (!existingUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  await db.prepare(`
    UPDATE users
    SET is_active = 0, account_status = 'deleted'
    WHERE id = ?
  `).run(userId);

  req.flash('success', `Marked user ${existingUser.email} as deleted. Existing records were preserved.`);
  return res.redirect('/admin/users');
}));

app.post('/admin/users/:id/restore', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user.');
    return res.redirect('/admin/users');
  }

  const existingUser = await db.prepare('SELECT id, email, email_verified_at FROM users WHERE id = ?').get(userId);
  if (!existingUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  await db.prepare(`
    UPDATE users
    SET account_status = 'active', is_active = ?
    WHERE id = ?
  `).run(existingUser.email_verified_at ? 1 : 0, userId);

  req.flash('success', `Restored user ${existingUser.email}.`);
  return res.redirect('/admin/users');
}));

app.post('/admin/ccd-classes', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const gradeLevel = typeof req.body.grade_level === 'string' ? req.body.grade_level.trim() : '';
  const classTime = typeof req.body.class_time === 'string' ? req.body.class_time.trim() : '';
  const classroom = typeof req.body.classroom === 'string' ? req.body.classroom.trim() : '';

  if (!gradeLevel) {
    req.flash('error', 'Please enter a grade level.');
    return res.redirect('/admin/users');
  }

  await db.prepare(
    `INSERT INTO ccd_classes (grade_level, class_time, classroom) VALUES (?, ?, ?)`
  ).run(gradeLevel, classTime, classroom);
  req.flash('success', 'CCD class saved. A grade can have multiple time-slot sections — add another with the same grade to offer parents a choice.');
  return res.redirect('/admin/users');
}));

app.post('/admin/ccd-classes/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM ccd_classes WHERE id = ?').run(req.params.id);
  req.flash('success', 'CCD class removed.');
  return res.redirect('/admin/users');
}));

app.post('/admin/ccd-classes/:id/update', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const sectionLabel = typeof req.body.section_label === 'string' ? req.body.section_label.trim().slice(0, 10) : '';
  const classTime = typeof req.body.class_time === 'string' ? req.body.class_time.trim() : '';
  const classroom = typeof req.body.classroom === 'string' ? req.body.classroom.trim() : '';
  const rawCatechistIds = req.body.catechist_user_ids;
  const catechistIds = (Array.isArray(rawCatechistIds) ? rawCatechistIds : (rawCatechistIds ? [rawCatechistIds] : []))
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id));

  if (!Number.isInteger(classId)) {
    req.flash('error', 'Invalid CCD class.');
    return res.redirect('/admin/users');
  }

  if (catechistIds.length) {
    const validCatechists = await db.prepare(
      `SELECT id FROM users WHERE role = 'catechist' AND COALESCE(account_status, 'active') <> 'deleted' AND id IN (${catechistIds.map(() => '?').join(',')})`
    ).all(...catechistIds);
    if (validCatechists.length !== catechistIds.length) {
      req.flash('error', 'One or more selected users is not a catechist.');
      return res.redirect('/admin/users');
    }
  }

  await db.prepare(
    'UPDATE ccd_classes SET section_label = ?, class_time = ?, classroom = ? WHERE id = ?'
  ).run(sectionLabel || null, classTime || null, classroom || null, classId);

  await db.prepare('DELETE FROM ccd_class_catechists WHERE ccd_class_id = ?').run(classId);
  for (const catechistId of catechistIds) {
    await db.prepare('INSERT INTO ccd_class_catechists (ccd_class_id, catechist_user_id) VALUES (?, ?)').run(classId, catechistId);
  }

  req.flash('success', 'Class updated.');
  return res.redirect('/admin/users');
}));

const isClassCatechist = (ccdClass, userId) =>
  (ccdClass.catechists || []).some((catechist) => Number(catechist.id) === Number(userId));

app.get('/admin/classes', requireAuth, requireRole('admin', 'catechist'), asyncHandler(async (req, res) => {
  const allCcdClasses = await getCcdClasses();
  const ccdClasses = req.user.role === 'catechist'
    ? allCcdClasses.filter((c) => isClassCatechist(c, req.user.id))
    : allCcdClasses;
  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();

  const classes = ccdClasses.map((ccdClass) => {
    const roster = getClassRoster(ccdClass, activeStudentRegs);
    const upcomingDates = getUpcomingSessionDates(ccdClass.class_time);
    return {
      ...ccdClass,
      studentCount: roster.length,
      pendingCount: roster.filter(isPendingAcceptance).length,
      nextSessionDate: upcomingDates[0] || null,
    };
  });

  res.render('admin-classes', { classes, ccdGradeMeanings: CCD_GRADE_MEANINGS });
}));

app.get('/admin/classes/:id', requireAuth, requireRole('admin', 'catechist'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClasses = await getCcdClasses();
  const ccdClass = ccdClasses.find((c) => c.id === classId);
  const ownsClass = ccdClass && (req.user.role === 'admin' || isClassCatechist(ccdClass, req.user.id));
  if (!ownsClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();
  const roster = getClassRoster(ccdClass, activeStudentRegs)
    .sort((a, b) => (a.student_full_name || '').localeCompare(b.student_full_name || ''));

  const upcomingDates = getUpcomingSessionDates(ccdClass.class_time);
  const nextSessionValue = upcomingDates[0] ? formatSessionDateValue(upcomingDates[0]) : null;
  const requestedDate = typeof req.query.date === 'string' ? req.query.date : '';
  const selectedDate = upcomingDates.some((d) => formatSessionDateValue(d) === requestedDate)
    ? requestedDate
    : (nextSessionValue || '');

  const attendanceRows = selectedDate
    ? await db.prepare(
        'SELECT student_registration_id, status FROM ccd_class_attendance WHERE ccd_class_id = ? AND session_date = ?'
      ).all(classId, selectedDate)
    : [];
  const attendanceByStudent = {};
  attendanceRows.forEach((row) => { attendanceByStudent[row.student_registration_id] = row.status; });

  const presentCount = attendanceRows.filter((row) => row.status === 'present').length;
  const absentCount = attendanceRows.filter((row) => row.status === 'absent').length;

  res.render('admin-class-detail', {
    ccdClass,
    roster,
    isPendingAcceptance,
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
    upcomingDates: upcomingDates.map((d) => ({ value: formatSessionDateValue(d), isNext: formatSessionDateValue(d) === nextSessionValue })),
    selectedDate,
    attendanceByStudent,
    presentCount,
    absentCount,
    unmarkedCount: roster.length - presentCount - absentCount,
  });
}));

app.post('/admin/classes/:id/attendance', requireAuth, requireRole('admin', 'catechist'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const studentRegistrationId = Number.parseInt(req.body.student_registration_id, 10);
  const sessionDate = typeof req.body.session_date === 'string' ? req.body.session_date : '';
  const status = typeof req.body.status === 'string' ? req.body.status : '';

  if (!Number.isInteger(classId) || !Number.isInteger(studentRegistrationId) || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }

  if (req.user.role === 'catechist') {
    const ownedClass = await db.prepare(
      'SELECT 1 FROM ccd_class_catechists WHERE ccd_class_id = ? AND catechist_user_id = ?'
    ).get(classId, req.user.id);
    if (!ownedClass) {
      return res.status(403).json({ ok: false, error: 'Forbidden.' });
    }
  }

  if (status === 'present' || status === 'absent') {
    await db.prepare(`
      INSERT INTO ccd_class_attendance (ccd_class_id, student_registration_id, session_date, status, marked_by)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)
    `).run(classId, studentRegistrationId, sessionDate, status, req.user.id);
  } else {
    await db.prepare(
      'DELETE FROM ccd_class_attendance WHERE ccd_class_id = ? AND student_registration_id = ? AND session_date = ?'
    ).run(classId, studentRegistrationId, sessionDate);
  }

  const attendanceRows = await db.prepare(
    'SELECT status FROM ccd_class_attendance WHERE ccd_class_id = ? AND session_date = ?'
  ).all(classId, sessionDate);
  const presentCount = attendanceRows.filter((row) => row.status === 'present').length;
  const absentCount = attendanceRows.filter((row) => row.status === 'absent').length;

  res.json({ ok: true, status: status === 'present' || status === 'absent' ? status : 'unmarked', presentCount, absentCount });
}));

app.post('/admin/classes/:id/message', requireAuth, requireRole('admin', 'catechist'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(classId)) {
    req.flash('error', 'Invalid class.');
    return res.redirect('/admin/classes');
  }

  const ccdClasses = await getCcdClasses();
  const ccdClass = ccdClasses.find((c) => c.id === classId);
  const ownsClass = ccdClass && (req.user.role === 'admin' || isClassCatechist(ccdClass, req.user.id));
  if (!ownsClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  if (!message) {
    req.flash('error', 'Please enter a message to send.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  const rawIds = req.body.student_registration_ids;
  const selectedIds = new Set(
    (Array.isArray(rawIds) ? rawIds : (rawIds ? [rawIds] : []))
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isInteger(id))
  );

  if (!selectedIds.size) {
    req.flash('error', 'Select at least one student to message.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();
  const selectedStudents = getClassRoster(ccdClass, activeStudentRegs).filter((r) => selectedIds.has(r.id));

  // Dedupe by parent email so siblings selected in the same class don't get a duplicate copy.
  const recipientsByEmail = new Map();
  selectedStudents.forEach((r) => {
    const email = (r.primary_contact_email || '').trim();
    if (email) recipientsByEmail.set(email.toLowerCase(), email);
  });

  if (!recipientsByEmail.size) {
    req.flash('error', 'None of the selected students have a contact email on file.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  const senderName = req.user.full_name || req.user.email;
  let sentCount = 0;
  for (const email of recipientsByEmail.values()) {
    const result = await sendClassMessageEmail({ to: email, subject, message, senderName });
    if (result.delivered) sentCount += 1;
  }

  const skippedCount = selectedStudents.length - recipientsByEmail.size;
  if (sentCount === 0) {
    req.flash('error', 'Message could not be sent — check the mail server configuration.');
  } else {
    req.flash(
      'success',
      `Message sent to ${sentCount} famil${sentCount === 1 ? 'y' : 'ies'}` +
        (skippedCount ? ` (${skippedCount} selected student${skippedCount === 1 ? '' : 's'} had no contact email on file).` : '.')
    );
  }
  return res.redirect(`/admin/classes/${classId}`);
}));

app.post('/admin/events', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const audience = typeof req.body.audience === 'string' ? req.body.audience.trim() : '';
  const validAudiences = ['children', 'family_faith', 'baptism_prep', 'ocia', 'general'];

  if (!title) {
    req.flash('error', 'Please enter an event title.');
    return res.redirect('/admin/users');
  }
  if (!validAudiences.includes(audience)) {
    req.flash('error', 'Please choose a valid audience.');
    return res.redirect('/admin/users');
  }

  await db.prepare(
    'INSERT INTO faith_formation_event_definitions (title, audience) VALUES (?, ?)'
  ).run(title, audience);
  req.flash('success', 'Faith formation event created.');
  return res.redirect('/admin/users');
}));

app.post('/admin/events/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM faith_formation_event_schedules WHERE event_definition_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM faith_formation_event_definitions WHERE id = ?').run(req.params.id);
  req.flash('success', 'Faith formation event removed.');
  return res.redirect('/admin/users');
}));

app.post('/admin/event-schedules', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const eventDefinitionId = Number(req.body.event_definition_id);
  const scheduleType = typeof req.body.schedule_type === 'string' ? req.body.schedule_type.trim() : 'one_time';
  const recurrencePattern = typeof req.body.recurrence_pattern === 'string' ? req.body.recurrence_pattern.trim() : '';
  const eventDate = typeof req.body.event_date === 'string' ? req.body.event_date.trim() : '';
  const eventTime = typeof req.body.event_time === 'string' ? req.body.event_time.trim() : '';
  const eventEndTime = typeof req.body.event_end_time === 'string' ? req.body.event_end_time.trim() : '';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';

  if (!Number.isInteger(eventDefinitionId) || eventDefinitionId <= 0) {
    req.flash('error', 'Please choose an event to schedule.');
    return res.redirect('/admin/users');
  }
  if (!['one_time', 'recurring'].includes(scheduleType)) {
    req.flash('error', 'Please choose a valid schedule type.');
    return res.redirect('/admin/users');
  }
  if (scheduleType === 'recurring' && !recurrencePattern) {
    req.flash('error', 'Please choose a weekday for recurring events.');
    return res.redirect('/admin/users');
  }
  if (scheduleType === 'one_time' && !eventDate) {
    req.flash('error', 'Please choose a date for one-time events.');
    return res.redirect('/admin/users');
  }

  await db.prepare(
    'INSERT INTO faith_formation_event_schedules (event_definition_id, schedule_type, recurrence_pattern, event_date, event_time, event_end_time, location) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    eventDefinitionId,
    scheduleType,
    scheduleType === 'recurring' ? recurrencePattern : null,
    scheduleType === 'one_time' ? eventDate : null,
    eventTime || null,
    eventEndTime || null,
    location || null
  );
  req.flash('success', 'Event schedule saved.');
  return res.redirect('/admin/users');
}));

app.post('/admin/event-schedules/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM faith_formation_event_schedules WHERE id = ?').run(req.params.id);
  req.flash('success', 'Event schedule removed.');
  return res.redirect('/admin/users');
}));

// Keep old routes working — GET redirects, old POST alias
app.get('/registration/new', requireAuth, (req, res) => res.redirect('/registration/children'));
app.get('/registration/adult', requireAuth, (req, res) => res.redirect('/registration/adult/ocia'));
// Old POST /registration — alias to /registration/children for any cached form submissions
app.post('/registration', requireAuth,
  certificateUpload.any(),
  normalizeCertificateUploads,
  handleChildrenRegistration
);

// ── Altar Server ─────────────────────────────────────────────

const getAltarServerTrainingDates = async ({ includePast = false } = {}) => {
  const rows = includePast
    ? await db.prepare(`
        SELECT id, training_date, training_time, location, notes
        FROM altar_server_training_dates
        ORDER BY training_date ASC, training_time ASC
      `).all()
    : await db.prepare(`
        SELECT id, training_date, training_time, location, notes
        FROM altar_server_training_dates
        WHERE training_date >= ?
        ORDER BY training_date ASC, training_time ASC
      `).all(getTodayDateValue());

  return rows.map((row) => {
    const dateValue = `${row.training_date}`.slice(0, 10);
    const dateLabel = formatAdorationDateLabel(dateValue);
    const timeLabel = formatTimeLabel(row.training_time);
    return {
      id: row.id,
      value: dateValue,
      label: `${dateLabel} at ${timeLabel}`,
      location: row.location || '',
      notes: row.notes || '',
    };
  });
};

app.get('/altar-server-signup', asyncHandler(async (_req, res) => {
  const trainingDates = await getAltarServerTrainingDates();
  res.render('altar-server-signup', {
    trainingDates,
    formData: {},
  });
}));

app.post('/altar-server-signup', asyncHandler(async (req, res) => {
  const childFirstName = typeof req.body.child_first_name === 'string' ? req.body.child_first_name.trim() : '';
  const childLastName = typeof req.body.child_last_name === 'string' ? req.body.child_last_name.trim() : '';
  const childDob = typeof req.body.child_dob === 'string' ? req.body.child_dob.trim() : '';
  const childGrade = typeof req.body.child_grade === 'string' ? req.body.child_grade.trim() : '';
  const parentName = typeof req.body.parent_name === 'string' ? req.body.parent_name.trim() : '';
  const parentEmail = typeof req.body.parent_email === 'string' ? req.body.parent_email.trim().toLowerCase() : '';
  const parentPhone = typeof req.body.parent_phone === 'string' ? req.body.parent_phone.trim() : '';
  const trainingDateId = req.body.training_date_id ? Number.parseInt(req.body.training_date_id, 10) : null;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

  const trainingDates = await getAltarServerTrainingDates();
  const formData = { child_first_name: childFirstName, child_last_name: childLastName, child_dob: childDob, child_grade: childGrade, parent_name: parentName, parent_email: parentEmail, parent_phone: parentPhone, training_date_id: trainingDateId, notes };

  if (!childFirstName || !childLastName || !parentName || !parentEmail || !parentPhone) {
    req.flash('error', 'Please fill in all required fields.');
    return res.render('altar-server-signup', { trainingDates, formData });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
    req.flash('error', 'Please enter a valid email address.');
    return res.render('altar-server-signup', { trainingDates, formData });
  }

  if (!phoneRegex.test(parentPhone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.render('altar-server-signup', { trainingDates, formData });
  }

  const resolvedTrainingDateId = (trainingDateId && trainingDates.some((d) => d.id === trainingDateId)) ? trainingDateId : null;

  await db.prepare(`
    INSERT INTO altar_server_signups
      (child_first_name, child_last_name, child_dob, child_grade, parent_name, parent_email, parent_phone, training_date_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(childFirstName, childLastName, childDob || null, childGrade || null, parentName, parentEmail, parentPhone, resolvedTrainingDateId, notes || null);

  req.flash('success', `Thank you! ${childFirstName}'s altar server signup has been received. We will contact you at ${parentEmail} with next steps.`);
  return res.redirect('/altar-server-signup');
}));

app.post('/admin/altar-server/training-dates', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const trainingDate = typeof req.body.training_date === 'string' ? req.body.training_date.trim() : '';
  const trainingTime = typeof req.body.training_time === 'string' ? req.body.training_time.trim() : '';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trainingDate)) {
    req.flash('error', 'Please choose a valid training date.');
    return res.redirect('/admin/users');
  }
  if (!/^\d{2}:\d{2}$/.test(trainingTime)) {
    req.flash('error', 'Please choose a valid training time.');
    return res.redirect('/admin/users');
  }

  try {
    await db.prepare(`
      INSERT INTO altar_server_training_dates (training_date, training_time, location, notes)
      VALUES (?, ?, ?, ?)
    `).run(trainingDate, trainingTime, location || null, notes || null);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      req.flash('error', `A training date is already scheduled for ${formatAdorationDateLabel(trainingDate)}.`);
      return res.redirect('/admin/users');
    }
    throw err;
  }

  req.flash('success', `Altar server training date added: ${formatAdorationDateLabel(trainingDate)} at ${formatTimeLabel(trainingTime)}.`);
  return res.redirect('/admin/users');
}));

app.post('/admin/altar-server/training-dates/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const dateId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(dateId) || dateId <= 0) {
    req.flash('error', 'Invalid training date.');
    return res.redirect('/admin/users');
  }
  await db.prepare('DELETE FROM altar_server_training_dates WHERE id = ?').run(dateId);
  req.flash('success', 'Altar server training date removed.');
  return res.redirect('/admin/users');
}));

app.post('/admin/altar-server/signups/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const signupId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(signupId) || signupId <= 0) {
    req.flash('error', 'Invalid altar server signup.');
    return res.redirect('/admin/users');
  }
  await db.prepare('DELETE FROM altar_server_signups WHERE id = ?').run(signupId);
  req.flash('success', 'Altar server signup removed.');
  return res.redirect('/admin/users');
}));

app.post('/admin/altar-server/signups/:id/status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const signupId = Number.parseInt(req.params.id, 10);
  const status = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!Number.isInteger(signupId) || signupId <= 0 || !validStatuses.includes(status)) {
    req.flash('error', 'Invalid request.');
    return res.redirect('/admin/users');
  }
  await db.prepare('UPDATE altar_server_signups SET status = ? WHERE id = ?').run(status, signupId);
  req.flash('success', 'Altar server signup status updated.');
  return res.redirect('/admin/users');
}));

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`St Matthew CCD app running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed.', error);
    process.exit(1);
  });
