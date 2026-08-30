require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');
const passport = require('./auth');
const db = require('./db');
const MySqlSessionStore = require('./session-store');
const { processScanDocument, verifyDocumentAiConfiguration } = require('./document-ai');
const { sendVerificationEmail, smtpLogConfig, verifyMailConfiguration, buildVerificationEmailContent, sendPasswordResetEmail, sendClassMessageEmail, sendCatechistInvitationEmail, sendTemporaryPasswordEmail } = require('./mailer');
const { listTemplatesWithFields, renderTemplate } = require('./email-templates');
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
// Children registrations track only the admission process itself. Once a
// child is admitted, their ongoing standing (Enrolled/Completed/Graduated/
// Discontinued/Transferred) is tracked separately on the `students` table
// so it survives independent of any one year's registration record.
const CHILD_REGISTRATION_STATUSES = [
  'in_progress',
  'conditionally_accepted',
  'admitted',
  'cancelled',
];
const STUDENT_STATUSES = [
  'enrolled',
  'completed',
  'graduated',
  'discontinued',
  'transferred',
];
// Family Faith registrations still use the original, unsplit status list.
const FAMILY_FAITH_REGISTRATION_STATUSES = [
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
    resources_nav: 'Resources',
    resources_page_title: 'Resources',
    resources_page_subtitle: 'Documents shared with you by the parish office.',
    no_resources: 'No resources have been shared with you yet.',
    resource_uploaded_by: 'Shared by',
    download_button: 'Download',
    manage_resources_nav: 'Resources',
    admin_resources_title: 'Resources',
    admin_resources_subtitle: 'Upload documents and choose who can see them.',
    add_resource_button: 'Add Resource',
    resource_title_label: 'Title',
    resource_description_label: 'Description (optional)',
    resource_file_label: 'File',
    resource_visible_to_roles_label: 'Visible to these user types',
    resource_visible_to_class_teachers_label: 'Visible to catechists of these classes',
    resource_visible_to_class_parents_label: "Visible to parents of these classes' students",
    resource_visible_to_individuals_label: 'Visible to these individuals',
    resource_class_teachers_label: 'Catechists of %s',
    resource_class_parents_label: "Parents of %s students",
    resource_class_participants_label: '%s participants',
    resource_visibility_label: 'Visible to',
    resource_title_and_file_required: 'Please enter a title and choose a file.',
    resource_assignment_required: 'Please choose at least one audience for this resource.',
    resource_added: 'Resource added.',
    resource_removed: 'Resource removed.',
    resource_not_found: 'Resource not found.',
    remove_resource_confirm: 'Remove this resource? This cannot be undone.',
    no_resources_yet: 'No resources uploaded yet.',
    notify_resource_checkbox_label: 'Also notify with a banner',
    notify_button_label: 'Notify',
    new_resource_notification_title: 'New resource added',
    view_resources_link: 'View Resources',
    dismiss_button: 'Got it',
    manage_notifications_nav: 'Notifications',
    admin_notifications_title: 'Notifications',
    admin_notifications_subtitle: 'Send announcements shown as a banner on every page until dismissed.',
    add_notification_button: 'Send Notification',
    notification_title_label: 'Title',
    notification_message_label: 'Message (optional)',
    notification_title_required: 'Please enter a title.',
    notification_added: 'Notification sent.',
    notification_removed: 'Notification removed.',
    no_notifications_yet: 'No notifications sent yet.',
    remove_notification_confirm: "Remove this notification? Anyone who hasn't dismissed it yet will stop seeing it.",
    acknowledged_count_label: 'acknowledged',
    manage_catechists_nav: 'Discipleship Team',
    admin_catechists_title: 'Discipleship Team',
    admin_catechists_subtitle: 'Message a catechist directly, or jump to Resources/Notifications with them pre-selected.',
    catechist_classes_label: 'Classes',
    no_classes_assigned_label: 'No classes assigned',
    catechist_message_button: 'Message',
    catechist_message_subject_label: 'Subject (optional)',
    catechist_message_body_label: 'Message',
    catechist_message_send_button: 'Send Email',
    catechist_assign_resource_button: 'Assign Resource',
    catechist_send_notification_button: 'Send Notification',
    catechist_not_found: 'Catechist not found.',
    catechist_message_required: 'Please enter a message to send.',
    catechist_message_sent: 'Message sent to %s.',
    catechist_message_failed: 'Message could not be sent — check the mail server configuration.',
    no_catechists_yet: 'No catechists yet.',
    staff_broadcast_header: 'Message All Staff',
    staff_broadcast_roles_label: 'Send to',
    staff_broadcast_template_label: 'Email template',
    staff_broadcast_template_blank_option: 'Plain message',
    staff_broadcast_template_fields_hint: 'Fill in the highlighted spots below — anything left blank keeps its placeholder text.',
    staff_broadcast_preview_button: 'Preview',
    staff_broadcast_send_button: 'Send to Staff',
    staff_broadcast_roles_required: 'Choose at least one group to send to.',
    staff_broadcast_no_recipients: 'No active users found for the selected group(s).',
    staff_broadcast_sent: 'Message sent — %s staff member(s) Bcc\'d.',
    staff_broadcast_partial: 'Only %s of %s staff member(s) received the message — these addresses were rejected: %s',
    class_message_bcc_partial: 'Only %s of %s recipient(s) received the message — these addresses were rejected: %s',
    registration: 'Registration',
    signed_in_as: 'Signed in as',
    new_registration: 'New Registration',
    calendar: 'Calendar',
    manage_users: 'Admin Panel',
    manage_visit_availability: 'Manage Visit Availability',
    submitted_registrations: 'Submitted Registrations',
    student: 'Student',
    grade: 'Grade',
    adult_faith_formation_label: 'Adult Faith Formation',
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
    filter_by_type: 'Type of registration',
    registration_type_child: 'Children\'s Faith Formation',
    registration_type_family_faith: 'Family Faith Formation',
    registration_type_adult: 'Adult Programs',
    registration_type_sponsor_confirmation: 'Sponsor Confirmation Forms',
    status_filter_active: 'Active',
    status_filter_archived: 'Archived',
    registrations_filter_summary: '%s of %s registrations',
    results_count_label: '%s results',
    filters_panel_title: 'Filters',
    collapse_filters: 'Collapse filters',
    expand_filters: 'Expand filters',
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
    calendar_class_day_title: 'Faith Formation Classes',
    calendar_events_legend_label: 'Parish Events',
    year_view_label: 'Full Year (Printable)',
    year_calendar_title: 'Faith Formation Year',
    session_calendar_label: 'Session Calendar',
    class_session_fallback_label: 'Class session',
    year_calendar_legend: 'Confirmed class day',
    year_calendar_off_weekday_legend: 'Day of the week with no class',
    print_button: 'Print',
    back_to_calendar: 'Back to Calendar',
    session_count_label: 'sessions',
    legend_class_session: 'Class session',
    legend_special_day: 'Special day',
    no_sessions_scheduled: 'No class days scheduled yet for this year.',
    parish_faith_formation_office: 'St. Matthew Parish · Faith Formation Office',
    verify_sacramental_records_note: 'Please verify all sacramental records before submission.',
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
    edit_profile: 'Edit profile',
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
    students_nav: 'Students',
    all_students_header: 'Students',
    all_students_subtitle: 'Every child admitted into faith formation, with their ongoing enrollment status.',
    no_accepted_students: 'No students have been admitted yet.',
    no_students_match_filters: 'No students match these filters.',
    students_filter_summary: '%s of %s students',
    student_deleted: 'Student record deleted.',
    confirm_delete_student_prefix: 'Permanently delete the student record for',
    confirm_delete_student_suffix: 'This removes their enrollment, class, and sacrament history and cannot be undone. The linked registration itself will not be deleted.',
    edit_registration: 'View Registration',
    no_active_registration: 'No active registration',
    tuition_import_nav: 'Tuition Import',
    tuition_import_header: 'Tuition Payment Import',
    tuition_import_subtitle: 'Upload a payment gateway export to mark tuition as paid on this year\'s registrations.',
    tuition_import_year_label: 'School year',
    tuition_import_file_label: 'Payment export CSV',
    tuition_import_submit: 'Upload and Preview',
    tuition_import_review_header: 'Review Tuition Import',
    tuition_import_review_subtitle: 'Nothing has been saved yet. Review the matches below, adjust or skip any rows, then confirm.',
    tuition_import_row_amount: 'Amount',
    tuition_import_row_date: 'Paid on',
    tuition_import_row_transaction: 'Transaction',
    tuition_import_row_names_raw: 'Names on payment',
    tuition_import_row_email: 'Payer email',
    tuition_import_status_matched: 'Matched',
    tuition_import_status_review: 'Needs review',
    tuition_import_status_no_match: 'No match found',
    tuition_import_status_declined: 'Not accepted — skipped',
    tuition_import_status_already_imported: 'Already imported',
    tuition_import_already_imported_detail: 'A registration already has this transaction ID on file — this payment was imported previously, so it will be skipped.',
    tuition_import_already_imported_summary: '%s of these rows were already imported previously and will be skipped automatically.',
    tuition_import_skip_row: 'Skip this row',
    tuition_import_no_candidates: 'No registration found for this year with a matching email, name, or phone number. Apply manually from the Registrations page if this payment is valid.',
    tuition_import_possible_matches_label: 'Possible matches (not automatically selected — please verify)',
    tuition_import_matched_by: 'Matched by',
    tuition_import_reason_phone: 'phone number',
    tuition_import_reason_parent_name: 'parent name',
    tuition_import_reason_student_name: 'student name',
    tuition_import_confirm: 'Apply Selected Payments',
    tuition_import_cancel: 'Cancel',
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
    comments_col: 'Comments',
    student_details_toggle: 'Details',
    registered_years_label: 'Registered Years',
    no_registered_years: 'No registration history on file.',
    classes_attended_label: 'Classes Attended',
    no_classes_attended: 'No completed classes on file yet.',
    in_progress_label: 'In Progress',
    sacraments_label: 'Sacraments',
    baptism_not_recorded: 'Baptism not recorded.',
    first_communion_not_recorded: 'First Communion not recorded.',
    confirmation_not_recorded: 'Confirmation not recorded.',
    confirmation_received_on: 'Confirmed on %s',
    set_confirmation_date_label: 'Record Confirmation date',
    clear_confirmation_date_label: 'Clear',
    family_payments_label: 'Family Payments',
    no_family_payments: 'No payments recorded for this family yet.',
    payment_amount_col: 'Amount',
    payment_method_col: 'Method',
    payment_date_col: 'Date',
    payment_method_cash: 'Cash',
    payment_method_credit_card: 'Credit Card',
    payment_method_imported: 'Imported',
    record_payment_label: 'Record a Payment',
    payment_amount_placeholder: 'Amount ($)',
    select_payment_method: 'Select method',
    view_receipt_label: 'Receipt',
    receipt_title: 'Payment Receipt',
    receipt_received_from: 'Received From',
    receipt_for_student: 'For Student',
    receipt_school_year: 'School Year',
    receipt_amount: 'Amount',
    receipt_payment_method: 'Payment Method',
    receipt_payment_date: 'Payment Date',
    receipt_recorded_by: 'Recorded By',
    print_receipt: 'Print Receipt',
    back_to_students_label: 'Back to Students',
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
    my_students_tab: 'My Students',
    register_next_year: 'Register for Next Year',
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
    family_count_singular: 'family',
    family_count_plural: 'families',
    adult_events_nav: 'Adult Events',
    adult_classes_header: 'Adult Events',
    adult_classes_subtitle: 'OCIA and Family Faith Formation classes — rosters, contacts, and schedule.',
    add_adult_class_button: 'Add Adult Class',
    adult_program_label: 'Program',
    linked_class_label: 'Linked Class',
    linked_class_none_option: 'None (combined session)',
    linked_class_help: 'Runs alongside this children\'s class — set the same class time/room below if it should be concurrent.',
    backfill_family_faith_button: 'Back-fill from Linked Class',
    backfill_family_faith_hint: 'Enrolls families whose child was admitted before this class existed. Safe to click again — already-enrolled families are skipped.',
    next_label: 'Next',
    back_to_classes: 'Back to Classes',
    roster_label: 'Roster',
    class_teacher_label: 'Teacher',
    schedule_label: 'Schedule',
    view_class_calendar_label: 'View Class Calendar',
    no_schedule_dates: 'No class days scheduled yet.',
    generate_schedule_label: 'Generate Sept–May schedule',
    generate_schedule_hint: 'Adds a weekly class day (based on the class time above) for every week from September through May. Remove individual dates afterward for holidays or breaks, or add extra ones for makeup days.',
    generate_schedule_needs_weekday: 'Set a class time starting with a weekday (e.g. "Sunday 9:00 AM") before generating a schedule.',
    add_class_day_label: 'Add a class day',
    add_class_day_button: 'Add',
    class_day_description_placeholder: 'Note (optional)',
    save_description_button: 'Save',
    invalid_class_day: 'Please choose a valid date.',
    class_day_added: 'Class day added.',
    class_day_removed: 'Class day removed.',
    class_day_description_saved: 'Note saved.',
    class_day_type_saved: 'Class day type updated.',
    remove_class_day: 'Remove this class day',
    edit_class_day_note: 'Edit note for this class day',
    event_type_label: 'Type',
    event_type_class_day: 'Class Day',
    event_type_retreat: 'Retreat Day',
    event_type_rehearsal: 'Rehearsal',
    event_type_mass: 'Mass',
    attendance_label: 'Attendance',
    present_label: 'Present',
    absent_label: 'Absent',
    unmarked_label: 'unmarked',
    mark_all_present_button: 'Mark all present',
    clear_button: 'Clear',
    autosave_note: 'Attendance saves automatically as you mark it.',
    baptism_cert_pending_badge: 'Baptism cert. pending',
    altar_server_badge: 'Altar Server',
    years_old_label: 'yrs',
    upcoming_celebrations_label: 'Upcoming Birthdays & Anniversaries',
    no_upcoming_celebrations: 'None in the next 30 days.',
    birthday_label: 'Birthday',
    baptism_anniversary_label: 'Baptism anniversary',
    turning_label: 'turning',
    today_label: 'today',
    tomorrow_label: 'tomorrow',
    in_days_label: 'in',
    days_label: 'days',
    absence_singular: 'absence',
    absence_plural: 'absences',
    last_seven_label: 'Last 7',
    of_label: 'of',
    attended_label: 'attended',
    year_to_date_label: 'Year to date',
    average_attendance_label: 'average attendance',
    below_75_label: 'Below 75% attendance this year:',
    quick_template_absence_label: 'Absence follow-up',
    quick_template_documents_label: 'Missing documents',
    quick_template_reminder_label: 'Next class reminder',
    quick_template_absence_subject: 'We missed you in class',
    quick_template_absence_body: 'Hi! We noticed your child was not in class recently. Please let us know if there is anything we can help with, and we look forward to seeing them next time.',
    quick_template_documents_subject: 'Missing documents on file',
    quick_template_documents_body: 'Hi! We are missing a document (such as a baptism certificate) for your child\'s registration. Please send a copy when you have a chance so we can complete their file.',
    quick_template_reminder_subject: 'Reminder for our next class',
    quick_template_reminder_body: 'Hi! Just a reminder about our next class session. We look forward to seeing your child there!',
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
    copy_all_emails_label: 'Copy all emails',
    copy_teacher_emails_label: 'Copy teacher emails',
    assign_teacher_button: 'Assign',
    no_catechists_available: 'No other catechists available to assign.',
    remove_teacher_confirm: 'Remove this teacher from the class?',
    emails_copied_label: 'Copied!',
    no_emails_to_copy_label: 'No contact emails to copy.',
    copy_emails_failed_label: 'Could not copy — copy manually instead.',
    selected_suffix_label: 'selected',
    subject_label: 'Subject (optional)',
    subject_placeholder: 'e.g. Reminder for this Sunday',
    cc_email_label: 'Cc (optional)',
    cc_email_placeholder: 'you@example.com',
    send_as_bcc_label: 'Send as one email (Bcc all recipients)',
    send_as_bcc_hint: 'Sends a single email addressed to you with every family Bcc\'d, so recipients can\'t see each other\'s addresses. Leave unchecked to send each family its own copy.',
    message_label: 'Message',
    message_placeholder: 'Type your message to parents here...',
    attachments_label: 'Attachments (optional)',
    attachments_hint: 'Up to 5 files, 10 MB each.',
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
    mail_health: 'Mail Health',
    admin_tools_menu: 'Admin Tools',
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
    last_login_label: 'Last Login',
    never_logged_in: 'Never',
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
    enrolled: 'Enrolled',
    transferred: 'Transferred',
    student_status: 'Student Status',
    registration_status: 'Registration Status',
    confirm_close_year_warning: 'Closing Faith Formation registration for %s will archive every currently-Enrolled student\'s registration for this year and record their class as completed. This can\'t be easily undone. Continue?',
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
    resources_nav: 'Recursos',
    resources_page_title: 'Recursos',
    resources_page_subtitle: 'Documentos compartidos con usted por la oficina parroquial.',
    no_resources: 'Aún no se han compartido recursos con usted.',
    resource_uploaded_by: 'Compartido por',
    download_button: 'Descargar',
    manage_resources_nav: 'Recursos',
    admin_resources_title: 'Recursos',
    admin_resources_subtitle: 'Suba documentos y elija quién puede verlos.',
    add_resource_button: 'Agregar Recurso',
    resource_title_label: 'Título',
    resource_description_label: 'Descripción (opcional)',
    resource_file_label: 'Archivo',
    resource_visible_to_roles_label: 'Visible para estos tipos de usuario',
    resource_visible_to_class_teachers_label: 'Visible para catequistas de estas clases',
    resource_visible_to_class_parents_label: 'Visible para padres de estudiantes de estas clases',
    resource_visible_to_individuals_label: 'Visible para estas personas',
    resource_class_teachers_label: 'Catequistas de %s',
    resource_class_parents_label: 'Padres de estudiantes de %s',
    resource_class_participants_label: 'Participantes de %s',
    resource_visibility_label: 'Visible para',
    resource_title_and_file_required: 'Por favor ingrese un título y elija un archivo.',
    resource_assignment_required: 'Por favor elija al menos una audiencia para este recurso.',
    resource_added: 'Recurso agregado.',
    resource_removed: 'Recurso eliminado.',
    resource_not_found: 'Recurso no encontrado.',
    remove_resource_confirm: '¿Eliminar este recurso? Esta acción no se puede deshacer.',
    no_resources_yet: 'Aún no se han subido recursos.',
    notify_resource_checkbox_label: 'También notificar con un aviso',
    notify_button_label: 'Notificar',
    new_resource_notification_title: 'Nuevo recurso agregado',
    view_resources_link: 'Ver Recursos',
    dismiss_button: 'Entendido',
    manage_notifications_nav: 'Notificaciones',
    admin_notifications_title: 'Notificaciones',
    admin_notifications_subtitle: 'Envíe anuncios que se muestran como un aviso en cada página hasta que se descarten.',
    add_notification_button: 'Enviar Notificación',
    notification_title_label: 'Título',
    notification_message_label: 'Mensaje (opcional)',
    notification_title_required: 'Por favor ingrese un título.',
    notification_added: 'Notificación enviada.',
    notification_removed: 'Notificación eliminada.',
    no_notifications_yet: 'Aún no se han enviado notificaciones.',
    remove_notification_confirm: '¿Eliminar esta notificación? Quienes aún no la hayan descartado dejarán de verla.',
    acknowledged_count_label: 'confirmados',
    manage_catechists_nav: 'Equipo de Discipulado',
    admin_catechists_title: 'Equipo de Discipulado',
    admin_catechists_subtitle: 'Envíe un mensaje directo a un catequista, o vaya a Recursos/Notificaciones con ellos ya seleccionados.',
    catechist_classes_label: 'Clases',
    no_classes_assigned_label: 'Sin clases asignadas',
    catechist_message_button: 'Mensaje',
    catechist_message_subject_label: 'Asunto (opcional)',
    catechist_message_body_label: 'Mensaje',
    catechist_message_send_button: 'Enviar Correo',
    catechist_assign_resource_button: 'Asignar Recurso',
    catechist_send_notification_button: 'Enviar Notificación',
    catechist_not_found: 'Catequista no encontrado.',
    catechist_message_required: 'Por favor ingrese un mensaje para enviar.',
    catechist_message_sent: 'Mensaje enviado a %s.',
    catechist_message_failed: 'No se pudo enviar el mensaje: verifique la configuración del servidor de correo.',
    no_catechists_yet: 'Aún no hay catequistas.',
    staff_broadcast_header: 'Enviar Mensaje a Todo el Personal',
    staff_broadcast_roles_label: 'Enviar a',
    staff_broadcast_template_label: 'Plantilla de correo',
    staff_broadcast_template_blank_option: 'Mensaje simple',
    staff_broadcast_template_fields_hint: 'Complete los espacios resaltados a continuación — lo que deje en blanco conserva su texto de marcador de posición.',
    staff_broadcast_preview_button: 'Vista previa',
    staff_broadcast_send_button: 'Enviar al Personal',
    staff_broadcast_roles_required: 'Elija al menos un grupo para enviar.',
    staff_broadcast_no_recipients: 'No se encontraron usuarios activos para el/los grupo(s) seleccionado(s).',
    staff_broadcast_sent: 'Mensaje enviado — %s miembro(s) del personal en Cco.',
    staff_broadcast_partial: 'Solo %s de %s miembro(s) del personal recibieron el mensaje — estas direcciones fueron rechazadas: %s',
    class_message_bcc_partial: 'Solo %s de %s destinatario(s) recibieron el mensaje — estas direcciones fueron rechazadas: %s',
    registration: 'Inscripcion',
    signed_in_as: 'Conectado como',
    new_registration: 'Nueva Inscripción',
    calendar: 'Calendario',
    manage_users: 'Panel de Administracion',
    manage_visit_availability: 'Administrar Disponibilidad de Visitas',
    submitted_registrations: 'Inscripciones Enviadas',
    student: 'Estudiante',
    grade: 'Grado',
    adult_faith_formation_label: 'Formación en la Fe para Adultos',
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
    filter_by_type: 'Tipo de inscripción',
    registration_type_child: 'Formación en la Fe — Niños',
    registration_type_family_faith: 'Formación en la Fe Familiar',
    registration_type_adult: 'Programas para Adultos',
    registration_type_sponsor_confirmation: 'Formularios de Confirmación de Padrino',
    status_filter_active: 'Activa',
    status_filter_archived: 'Archivada',
    registrations_filter_summary: '%s de %s inscripciones',
    results_count_label: '%s resultados',
    filters_panel_title: 'Filtros',
    collapse_filters: 'Contraer filtros',
    expand_filters: 'Expandir filtros',
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
    calendar_class_day_title: 'Clases de Formación en la Fe',
    calendar_events_legend_label: 'Eventos Parroquiales',
    year_view_label: 'Año Completo (Imprimible)',
    year_calendar_title: 'Año de Formación en la Fe',
    session_calendar_label: 'Calendario de Sesiones',
    class_session_fallback_label: 'Día de clase',
    year_calendar_legend: 'Día de clase confirmado',
    year_calendar_off_weekday_legend: 'Día de la semana sin clase',
    print_button: 'Imprimir',
    back_to_calendar: 'Volver al Calendario',
    session_count_label: 'sesiones',
    legend_class_session: 'Día de clase',
    legend_special_day: 'Día especial',
    no_sessions_scheduled: 'Aún no hay días de clase programados para este año.',
    parish_faith_formation_office: 'Parroquia St. Matthew · Oficina de Formación en la Fe',
    verify_sacramental_records_note: 'Por favor verifique todos los registros sacramentales antes de enviar.',
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
    edit_profile: 'Editar perfil',
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
    students_nav: 'Estudiantes',
    all_students_header: 'Estudiantes',
    all_students_subtitle: 'Cada niño admitido en la formación en la fe, con su estado de inscripción continuo.',
    no_accepted_students: 'Aún no se ha admitido a ningún estudiante.',
    no_students_match_filters: 'Ningún estudiante coincide con estos filtros.',
    students_filter_summary: '%s de %s estudiantes',
    student_deleted: 'Registro de estudiante eliminado.',
    confirm_delete_student_prefix: 'Eliminar permanentemente el registro del estudiante',
    confirm_delete_student_suffix: 'Esto elimina su historial de inscripción, clases y sacramentos, y no se puede deshacer. La inscripción vinculada no será eliminada.',
    edit_registration: 'Ver Inscripción',
    no_active_registration: 'Sin inscripción activa',
    tuition_import_nav: 'Importar Matrícula',
    tuition_import_header: 'Importar Pagos de Matrícula',
    tuition_import_subtitle: 'Suba una exportación de la pasarela de pagos para marcar la matrícula como pagada en las inscripciones de este año.',
    tuition_import_year_label: 'Año escolar',
    tuition_import_file_label: 'CSV de exportación de pagos',
    tuition_import_submit: 'Subir y Previsualizar',
    tuition_import_review_header: 'Revisar Importación de Matrícula',
    tuition_import_review_subtitle: 'Nada se ha guardado todavía. Revise las coincidencias a continuación, ajuste u omita cualquier fila, y luego confirme.',
    tuition_import_row_amount: 'Monto',
    tuition_import_row_date: 'Pagado el',
    tuition_import_row_transaction: 'Transacción',
    tuition_import_row_names_raw: 'Nombres en el pago',
    tuition_import_row_email: 'Correo del pagador',
    tuition_import_status_matched: 'Coincide',
    tuition_import_status_review: 'Necesita revisión',
    tuition_import_status_no_match: 'Sin coincidencia',
    tuition_import_status_declined: 'No aceptado — omitido',
    tuition_import_status_already_imported: 'Ya importado',
    tuition_import_already_imported_detail: 'Una inscripción ya tiene este ID de transacción registrado — este pago se importó anteriormente, así que se omitirá.',
    tuition_import_already_imported_summary: '%s de estas filas ya se importaron anteriormente y se omitirán automáticamente.',
    tuition_import_skip_row: 'Omitir esta fila',
    tuition_import_no_candidates: 'No se encontró ninguna inscripción para este año con un correo, nombre o teléfono coincidente. Aplique manualmente desde la página de Inscripciones si este pago es válido.',
    tuition_import_possible_matches_label: 'Posibles coincidencias (no seleccionadas automáticamente — verifique)',
    tuition_import_matched_by: 'Coincide por',
    tuition_import_reason_phone: 'número de teléfono',
    tuition_import_reason_parent_name: 'nombre del padre/madre',
    tuition_import_reason_student_name: 'nombre del estudiante',
    tuition_import_confirm: 'Aplicar Pagos Seleccionados',
    tuition_import_cancel: 'Cancelar',
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
    comments_col: 'Comentarios',
    student_details_toggle: 'Detalles',
    registered_years_label: 'Años Inscritos',
    no_registered_years: 'No hay historial de inscripción registrado.',
    classes_attended_label: 'Clases a las que Asistió',
    no_classes_attended: 'Aún no hay clases completadas registradas.',
    in_progress_label: 'En Progreso',
    sacraments_label: 'Sacramentos',
    baptism_not_recorded: 'Bautismo no registrado.',
    first_communion_not_recorded: 'Primera Comunión no registrada.',
    confirmation_not_recorded: 'Confirmación no registrada.',
    confirmation_received_on: 'Confirmado el %s',
    set_confirmation_date_label: 'Registrar fecha de Confirmación',
    clear_confirmation_date_label: 'Borrar',
    family_payments_label: 'Pagos de la Familia',
    no_family_payments: 'Aún no hay pagos registrados para esta familia.',
    payment_amount_col: 'Monto',
    payment_method_col: 'Método',
    payment_date_col: 'Fecha',
    payment_method_cash: 'Efectivo',
    payment_method_credit_card: 'Tarjeta de Crédito',
    payment_method_imported: 'Importado',
    record_payment_label: 'Registrar un Pago',
    payment_amount_placeholder: 'Monto ($)',
    select_payment_method: 'Seleccione método',
    view_receipt_label: 'Recibo',
    receipt_title: 'Recibo de Pago',
    receipt_received_from: 'Recibido De',
    receipt_for_student: 'Para el Estudiante',
    receipt_school_year: 'Año Escolar',
    receipt_amount: 'Monto',
    receipt_payment_method: 'Método de Pago',
    receipt_payment_date: 'Fecha de Pago',
    receipt_recorded_by: 'Registrado Por',
    print_receipt: 'Imprimir Recibo',
    back_to_students_label: 'Volver a Estudiantes',
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
    my_students_tab: 'Mis Estudiantes',
    register_next_year: 'Inscribir para el Próximo Año',
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
    family_count_singular: 'familia',
    family_count_plural: 'familias',
    adult_events_nav: 'Eventos de Adultos',
    adult_classes_header: 'Eventos de Adultos',
    adult_classes_subtitle: 'Clases de OCIA y Formación en la Fe Familiar — listas, contactos y horario.',
    add_adult_class_button: 'Agregar Clase de Adultos',
    adult_program_label: 'Programa',
    linked_class_label: 'Clase Vinculada',
    linked_class_none_option: 'Ninguna (sesión combinada)',
    linked_class_help: 'Se realiza junto con esta clase de niños — use el mismo horario/salón abajo si debe ser simultánea.',
    backfill_family_faith_button: 'Rellenar desde la Clase Vinculada',
    backfill_family_faith_hint: 'Inscribe a las familias cuyo hijo fue admitido antes de que existiera esta clase. Se puede volver a usar — las familias ya inscritas se omiten.',
    next_label: 'Próxima',
    back_to_classes: 'Volver a Clases',
    roster_label: 'Lista de Estudiantes',
    class_teacher_label: 'Catequista',
    schedule_label: 'Horario',
    view_class_calendar_label: 'Ver Calendario de la Clase',
    no_schedule_dates: 'Aún no hay días de clase programados.',
    generate_schedule_label: 'Generar horario de Septiembre a Mayo',
    generate_schedule_hint: 'Agrega un día de clase semanal (según el horario de clase indicado arriba) para cada semana de Septiembre a Mayo. Luego puede eliminar fechas individuales por días festivos o descansos, o agregar fechas adicionales para clases de reposición.',
    generate_schedule_needs_weekday: 'Configure un horario de clase que comience con un día de la semana (ej. "Sunday 9:00 AM") antes de generar un horario.',
    add_class_day_label: 'Agregar un día de clase',
    add_class_day_button: 'Agregar',
    class_day_description_placeholder: 'Nota (opcional)',
    save_description_button: 'Guardar',
    invalid_class_day: 'Por favor elija una fecha válida.',
    class_day_added: 'Día de clase agregado.',
    class_day_removed: 'Día de clase eliminado.',
    class_day_description_saved: 'Nota guardada.',
    class_day_type_saved: 'Tipo de día de clase actualizado.',
    remove_class_day: 'Eliminar este día de clase',
    edit_class_day_note: 'Editar nota de este día de clase',
    event_type_label: 'Tipo',
    event_type_class_day: 'Día de Clase',
    event_type_retreat: 'Día de Retiro',
    event_type_rehearsal: 'Ensayo',
    event_type_mass: 'Misa',
    attendance_label: 'Asistencia',
    present_label: 'Presente',
    absent_label: 'Ausente',
    unmarked_label: 'sin marcar',
    mark_all_present_button: 'Marcar todos presentes',
    clear_button: 'Borrar',
    autosave_note: 'La asistencia se guarda automáticamente al marcarla.',
    baptism_cert_pending_badge: 'Certificado de bautismo pendiente',
    altar_server_badge: 'Monaguillo/a',
    years_old_label: 'años',
    upcoming_celebrations_label: 'Próximos Cumpleaños y Aniversarios',
    no_upcoming_celebrations: 'Ninguno en los próximos 30 días.',
    birthday_label: 'Cumpleaños',
    baptism_anniversary_label: 'Aniversario de bautismo',
    turning_label: 'cumple',
    today_label: 'hoy',
    tomorrow_label: 'mañana',
    in_days_label: 'en',
    days_label: 'días',
    absence_singular: 'ausencia',
    absence_plural: 'ausencias',
    last_seven_label: 'Últimas 7',
    of_label: 'de',
    attended_label: 'asistió',
    year_to_date_label: 'Año hasta la fecha',
    average_attendance_label: 'asistencia promedio',
    below_75_label: 'Por debajo del 75% de asistencia este año:',
    quick_template_absence_label: 'Seguimiento de ausencia',
    quick_template_documents_label: 'Documentos faltantes',
    quick_template_reminder_label: 'Recordatorio de próxima clase',
    quick_template_absence_subject: 'Le extrañamos en clase',
    quick_template_absence_body: '¡Hola! Notamos que su hijo/a no asistió recientemente a clase. Por favor avísenos si hay algo en lo que podamos ayudar, y esperamos verlo/a la próxima vez.',
    quick_template_documents_subject: 'Documentos faltantes en el expediente',
    quick_template_documents_body: '¡Hola! Nos falta un documento (como el certificado de bautismo) para la inscripción de su hijo/a. Por favor envíe una copia cuando pueda para completar su expediente.',
    quick_template_reminder_subject: 'Recordatorio de nuestra próxima clase',
    quick_template_reminder_body: '¡Hola! Solo un recordatorio sobre nuestra próxima sesión de clase. ¡Esperamos ver a su hijo/a allí!',
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
    copy_all_emails_label: 'Copiar todos los correos',
    copy_teacher_emails_label: 'Copiar correos de catequistas',
    assign_teacher_button: 'Asignar',
    no_catechists_available: 'No hay más catequistas disponibles para asignar.',
    remove_teacher_confirm: '¿Eliminar este catequista de la clase?',
    emails_copied_label: '¡Copiado!',
    no_emails_to_copy_label: 'No hay correos de contacto para copiar.',
    copy_emails_failed_label: 'No se pudo copiar — cópielo manualmente.',
    selected_suffix_label: 'seleccionados',
    subject_label: 'Asunto (opcional)',
    subject_placeholder: 'ej. Recordatorio para este domingo',
    cc_email_label: 'Cc (opcional)',
    cc_email_placeholder: 'tu@ejemplo.com',
    send_as_bcc_label: 'Enviar como un solo correo (Cco a todos los destinatarios)',
    send_as_bcc_hint: 'Envía un único correo dirigido a usted con cada familia en Cco, para que los destinatarios no vean las direcciones de los demás. Déjelo sin marcar para enviar a cada familia su propia copia.',
    message_label: 'Mensaje',
    message_placeholder: 'Escriba su mensaje para los padres aquí...',
    attachments_label: 'Archivos adjuntos (opcional)',
    attachments_hint: 'Hasta 5 archivos, 10 MB cada uno.',
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
    mail_health: 'Estado de Correo',
    admin_tools_menu: 'Herramientas de Administrador',
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
    last_login_label: 'Último Ingreso',
    never_logged_in: 'Nunca',
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
    enrolled: 'Inscrito',
    transferred: 'Transferido',
    student_status: 'Estado del Estudiante',
    registration_status: 'Estado de la Inscripción',
    confirm_close_year_warning: 'Cerrar la inscripción de Formación en la Fe para %s archivará la inscripción de este año de cada estudiante actualmente Inscrito y registrará su clase como completada. Esto no se puede deshacer fácilmente. ¿Continuar?',
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
  ocia: 'OCIA',
};

// Short codes for the sacramental-year classes, used anywhere space is tight (calendar
// pills, etc). Grades without a code (3-7) already display fine as "Grade N".
const CCD_GRADE_SHORT_CODES = {
  '1': 'HC-1',
  '2': 'HC-2',
  '8': 'C-1',
  '9': 'C-2',
};

// Adult programs beyond OCIA (already in CCD_GRADE_MEANINGS) get their own grade_level
// key rather than one added to that shared map — CCD_GRADE_MEANINGS also backs the
// Registrations/Students grade filters and the main "Add Class" dropdown, and a program
// with no children on the roster has no business appearing as a filterable "grade" there.
const ADULT_PROGRAM_LABELS = {
  family_faith: 'Family Faith Formation',
};

const getCcdClassShortLabel = (ccdClass) =>
  `${CCD_GRADE_SHORT_CODES[ccdClass.grade_level] || CCD_GRADE_MEANINGS[ccdClass.grade_level] || ADULT_PROGRAM_LABELS[ccdClass.grade_level] || ccdClass.grade_level}${ccdClass.sectionLabel || ''}`;

// Fixed display order (Communion years before Confirmation years) for anywhere the short
// codes need explaining, e.g. the shared calendar's legend.
const CCD_GRADE_SHORT_CODE_LEGEND = ['1', '2', '8', '9'].map((gradeLevel) => ({
  code: CCD_GRADE_SHORT_CODES[gradeLevel],
  label: CCD_GRADE_MEANINGS[gradeLevel],
}));

// What kind of gathering a stored class-schedule date represents — 'class_day' (the
// default/plain case) is a regular class session; the rest cover the other calendar
// entries a faith formation schedule needs (translated via event_type_* keys).
const CLASS_SESSION_EVENT_TYPES = ['class_day', 'retreat', 'rehearsal', 'mass'];
const isValidClassSessionEventType = (value) => CLASS_SESSION_EVENT_TYPES.includes(value);

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

// class_time is free text an admin typed (e.g. "Tuesday 4:00-5:15 PM") with the weekday
// and time range run together. Splits them apart for display contexts — like a calendar
// grid — where the weekday is already implied (a column header, a specific date) and
// repeating it in every pill/label would just be noise.
const splitClassTimeText = (classTimeText) => {
  const match = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b(.*)$/i.exec((classTimeText || '').trim());
  return {
    weekday: match ? match[1] : '',
    timeRange: match ? match[2].trim() : (classTimeText || ''),
  };
};

// When a grade has more than one time-slot section (e.g. three Second Year Communion
// sections), admins assign each a "A"/"B"/"C" section_label directly (see
// POST /admin/ccd-classes/:id/section-label) so they can refer to "2A" instead of an
// ambiguous repeated grade number. Stored, not computed, so it stays put once set.
const getCcdClasses = async () => {
  const ccdClasses = await db.prepare(`
    SELECT classes.id, classes.grade_level, classes.class_time, classes.classroom,
           classes.section_label AS sectionLabel, classes.class_kind AS classKind,
           classes.source_program_type AS sourceProgramType, classes.linked_class_id AS linkedClassId
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
//
// Once a registration is Admitted, whether it still counts as an active roster member is
// governed by its linked `students` row's student_status (Enrolled), not the registration
// itself — a student who later becomes Completed/Graduated/Discontinued/Transferred drops
// off class rosters even though their registration stays "admitted" forever. Registrations
// that aren't admitted yet (in_progress/conditionally_accepted) are unaffected and keep
// showing as pending, exactly as before.
// dob strings are plain YYYY-MM-DD with no time/zone info, so the year/month/day are
// parsed directly rather than via `new Date(dob)` — that constructor treats a date-only
// string as UTC midnight, which flips to the previous local day in negative-UTC-offset
// timezones and silently off-by-ones the age near birthdays/month boundaries.
const calculateAge = (dob) => {
  const match = typeof dob === 'string' && dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, birthYear, birthMonth, birthDay] = match.map(Number);
  const today = new Date();
  let age = today.getFullYear() - birthYear;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > birthMonth ||
    (today.getMonth() + 1 === birthMonth && today.getDate() >= birthDay);
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
};

// Finds the next occurrence (this year or next) of an annual date like a birthday or
// baptism date, for surfacing "upcoming" reminders. Returns null past `withinDays`, or if
// `dateStr` is missing/unparseable. A Feb 29 anniversary rolls to Mar 1 in non-leap years
// (native Date overflow) rather than being skipped — an acceptable once-every-4-years quirk.
const getUpcomingAnniversary = (dateStr, withinDays = 30) => {
  const match = typeof dateStr === 'string' && dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, origYear, month, day] = match.map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let nextYear = today.getFullYear();
  let next = new Date(nextYear, month - 1, day);
  if (next < today) {
    nextYear += 1;
    next = new Date(nextYear, month - 1, day);
  }
  const daysUntil = Math.round((next - today) / 86400000);
  if (daysUntil > withinDays) return null;
  return { date: formatSessionDateValue(next), daysUntil, years: nextYear - origYear };
};

// Adapts an adult_registrations row into the same shape the roster templates,
// attendance routes, and messaging route already expect from a student_registrations
// row — student_full_name/primary_contact_email/etc — so none of that shared code needs
// to know or care which table a given roster member actually came from. Fields with no
// adult equivalent (parent_name, baptism_certificate_path, ...) are left null; the
// templates already render those as optional/absent.
const mapAdultRegistrationToRosterRow = (reg) => ({
  id: reg.id,
  student_full_name: reg.full_name,
  student_dob: reg.dob,
  parent_name: null,
  primary_contact_relationship: null,
  primary_contact_email: reg.email,
  primary_contact_phone: reg.phone,
  baptism_certificate_path: null,
  baptism_date: null,
  disabilities_comments: reg.comments,
  // Adult sign-ups have no admitted/conditionally-accepted admission pipeline like
  // children's registrations do — once on the roster, they're never "pending" — so this
  // is hardcoded to satisfy isPendingAcceptance rather than passed through from
  // adult_registrations.status (which tracks form-completion progress, not admission).
  status: 'admitted',
  user_id: reg.user_id,
  archived_at: reg.archived_at,
});

// Family Faith Formation has no per-person sign-up like adult_registrations — one row is
// a whole household (see family_faith_registrations.members_json) — so a roster row here
// represents the family, not an individual. Same shared-shape adaptation as above.
const mapFamilyFaithRegistrationToRosterRow = (reg) => ({
  id: reg.id,
  student_full_name: reg.family_name,
  student_dob: null,
  parent_name: reg.primary_contact_name,
  primary_contact_relationship: null,
  primary_contact_email: reg.primary_contact_email,
  primary_contact_phone: reg.primary_contact_phone,
  baptism_certificate_path: null,
  baptism_date: null,
  disabilities_comments: null,
  status: 'admitted',
  user_id: reg.user_id,
  archived_at: null,
});

// 'adult' classes (OCIA, Family Faith Formation, and any future adult program) roster
// from a program-specific table instead of student_registrations — there's no
// grade/time-slot matching or admitted/enrolled two-step gate for those, just "is an
// active signup for this class's program". allAdultRegs/allFamilyFaithRegs are only
// needed for adult classes; children-class callers can omit them.
const getClassRoster = (ccdClass, allStudentRegs, enrolledRegistrationIds, allAdultRegs = [], allFamilyFaithRegs = [], allCcdClasses = []) => {
  if (ccdClass.classKind === 'adult') {
    if (ccdClass.sourceProgramType === 'family_faith') {
      // A Family Faith Formation session paired with a specific children's class (e.g. the
      // one running alongside First Year Holy Communion) only rosters families whose child
      // is actually on that linked class's roster — matched by the registering parent's
      // user_id, the one field both a family registration and a student registration
      // reliably share. An unlinked FFF class (linkedClassId null) rosters every active
      // household instead, for a single combined session.
      if (ccdClass.linkedClassId) {
        const linkedClass = allCcdClasses.find((c) => c.id === ccdClass.linkedClassId);
        const linkedParentUserIds = linkedClass
          ? new Set(getClassRoster(linkedClass, allStudentRegs, enrolledRegistrationIds).map((r) => r.user_id).filter(Boolean))
          : new Set();
        return allFamilyFaithRegs.filter((reg) => linkedParentUserIds.has(reg.user_id)).map(mapFamilyFaithRegistrationToRosterRow);
      }
      return allFamilyFaithRegs.map(mapFamilyFaithRegistrationToRosterRow);
    }
    return allAdultRegs
      .filter((reg) => reg.program_type === (ccdClass.sourceProgramType || 'ocia'))
      .map(mapAdultRegistrationToRosterRow);
  }
  return allStudentRegs.filter((reg) => {
    if (resolveCcdGrade(reg) !== ccdClass.grade_level) return false;
    if (reg.status === 'admitted' && !enrolledRegistrationIds.has(reg.id)) return false;
    if (!SACRAMENTAL_GRADE_LEVELS.has(ccdClass.grade_level)) return true;
    return reg.preferred_class_time === ccdClass.class_time || reg.preferred_class_time === getClassSlotValue(ccdClass);
  });
};

const getActiveAdultRegistrations = async () =>
  db.prepare('SELECT * FROM adult_registrations WHERE archived_at IS NULL').all();

// family_faith_registrations has no archived_at column — 'cancelled'/'discontinued' is
// its equivalent of "no longer active" (see FAMILY_FAITH_REGISTRATION_STATUSES).
const getActiveFamilyFaithRegistrations = async () =>
  db.prepare(`SELECT * FROM family_faith_registrations WHERE status NOT IN ('cancelled', 'discontinued')`).all();

const getEnrolledRegistrationIds = async () => {
  const rows = await db.prepare(
    `SELECT source_registration_id FROM students WHERE student_status = 'enrolled' AND source_registration_id IS NOT NULL`
  ).all();
  return new Set(rows.map((row) => row.source_registration_id));
};

// Classes this catechist teaches, for resolving "resource visible to catechists of
// class X" — reuses the same ccd_class_catechists membership as everywhere else.
const getCatechistClassIds = async (userId) => {
  const ccdClasses = await getCcdClasses();
  return ccdClasses.filter((c) => isClassCatechist(c, userId)).map((c) => c.id);
};

// Classes this parent has a child on the roster of, for resolving "resource visible to
// parents of class X". There's no stored parent->class link (class membership is
// computed from grade/time-slot matching — see getClassRoster), so this replicates that
// same matching scoped to just this parent's own registrations.
const getParentClassIds = async (parentUserId) => {
  const parentStudentRegs = await db.prepare(
    'SELECT * FROM student_registrations WHERE archived_at IS NULL AND user_id = ?'
  ).all(parentUserId);
  const parentAdultRegs = await db.prepare(
    'SELECT * FROM adult_registrations WHERE archived_at IS NULL AND user_id = ?'
  ).all(parentUserId);
  if (!parentStudentRegs.length && !parentAdultRegs.length) return [];
  const ccdClasses = await getCcdClasses();
  const enrolledRegistrationIds = await getEnrolledRegistrationIds();
  return ccdClasses
    .filter((c) => getClassRoster(c, parentStudentRegs, enrolledRegistrationIds, parentAdultRegs).length > 0)
    .map((c) => c.id);
};

// Shared by Resources and Notifications — both use the identical assignment-rule shape
// (role / class_teachers / class_parents / user) to decide who something is visible to.
const userMatchesAssignmentRules = (assignments, user, catechistClassIds, parentClassIds) =>
  assignments.some((rule) => {
    if (rule.assignment_type === 'role') return rule.role === user.role;
    if (rule.assignment_type === 'class_teachers') return catechistClassIds.has(rule.ccd_class_id);
    if (rule.assignment_type === 'class_parents') return parentClassIds.has(rule.ccd_class_id);
    if (rule.assignment_type === 'user') return Number(rule.target_user_id) === Number(user.id);
    return false;
  });

const ASSIGNABLE_AUDIENCE_ROLES = ['user', 'catechist', 'family_faith_leader', 'admin'];

// Parses the shared audience-picker form fields (role checkboxes, two class multi-selects,
// an individual-user multi-select) — used by both the resource and notification create
// forms, which share the same field names.
const parseAssignmentFieldsFromBody = (body) => ({
  roles: [].concat(body.roles || []).filter((r) => ASSIGNABLE_AUDIENCE_ROLES.includes(r)),
  classTeacherIds: [].concat(body.class_teacher_ids || []).map((v) => Number.parseInt(v, 10)).filter(Number.isInteger),
  classParentIds: [].concat(body.class_parent_ids || []).map((v) => Number.parseInt(v, 10)).filter(Number.isInteger),
  targetUserIds: [].concat(body.target_user_ids || []).map((v) => Number.parseInt(v, 10)).filter(Number.isInteger),
});

const hasAnyAssignment = (fields) =>
  fields.roles.length > 0 || fields.classTeacherIds.length > 0 || fields.classParentIds.length > 0 || fields.targetUserIds.length > 0;

// Writes one row per rule into whichever assignments table (resource_assignments or
// notification_assignments) — both share the exact same column shape.
const insertAssignmentRows = async (table, ownerColumn, ownerId, fields) => {
  const rows = [
    ...fields.roles.map((role) => [ownerId, 'role', role, null, null]),
    ...fields.classTeacherIds.map((id) => [ownerId, 'class_teachers', null, id, null]),
    ...fields.classParentIds.map((id) => [ownerId, 'class_parents', null, id, null]),
    ...fields.targetUserIds.map((id) => [ownerId, 'user', null, null, id]),
  ];
  for (const row of rows) {
    await db.prepare(
      `INSERT INTO ${table} (${ownerColumn}, assignment_type, role, ccd_class_id, target_user_id) VALUES (?, ?, ?, ?, ?)`
    ).run(...row);
  }
};

// The inverse of insertAssignmentRows — turns stored assignment rows (e.g. a resource's
// existing resource_assignments) back into the {roles, classTeacherIds, ...} shape, for
// copying one thing's audience onto another (see the resource "notify" action below).
const assignmentRowsToFields = (rows) => ({
  roles: rows.filter((r) => r.assignment_type === 'role').map((r) => r.role),
  classTeacherIds: rows.filter((r) => r.assignment_type === 'class_teachers').map((r) => r.ccd_class_id),
  classParentIds: rows.filter((r) => r.assignment_type === 'class_parents').map((r) => r.ccd_class_id),
  targetUserIds: rows.filter((r) => r.assignment_type === 'user').map((r) => r.target_user_id),
});

// Human-readable label for one audience rule — shared by the Resources and Notifications
// admin list pages, which both show a summary of who a thing is visible to.
const buildAssignmentDescriber = (t, ccdClassById, userById) => {
  const roleLabels = {
    user: t('role_user'),
    catechist: t('role_catechist'),
    family_faith_leader: t('family_faith_leader'),
    admin: t('role_admin'),
  };
  const describeAssignment = (rule) => {
    if (rule.assignment_type === 'role') return roleLabels[rule.role] || rule.role;
    if (rule.assignment_type === 'class_teachers') {
      const c = ccdClassById.get(rule.ccd_class_id);
      return t('resource_class_teachers_label').replace('%s', c ? getCcdClassShortLabel(c) : `#${rule.ccd_class_id}`);
    }
    if (rule.assignment_type === 'class_parents') {
      const c = ccdClassById.get(rule.ccd_class_id);
      // An adult class has no "parents" — the target is the registrants themselves.
      const labelKey = c && c.classKind === 'adult' ? 'resource_class_participants_label' : 'resource_class_parents_label';
      return t(labelKey).replace('%s', c ? getCcdClassShortLabel(c) : `#${rule.ccd_class_id}`);
    }
    if (rule.assignment_type === 'user') {
      const u = userById.get(rule.target_user_id);
      return u ? (u.full_name || u.email) : `#${rule.target_user_id}`;
    }
    return rule.assignment_type;
  };
  return { roleLabels, describeAssignment };
};

// A user's own resource library: every resource with at least one assignment rule that
// matches them. Admins manage the full library separately (see /admin/resources) but
// still only see their own assigned resources here, same as everyone else.
const getVisibleResourcesForUser = async (user) => {
  const resources = await db.prepare('SELECT * FROM resources ORDER BY created_at DESC').all();
  if (!resources.length) return [];

  const assignments = await db.prepare('SELECT * FROM resource_assignments').all();
  const assignmentsByResource = new Map();
  assignments.forEach((a) => {
    if (!assignmentsByResource.has(a.resource_id)) assignmentsByResource.set(a.resource_id, []);
    assignmentsByResource.get(a.resource_id).push(a);
  });

  const catechistClassIds = new Set(await getCatechistClassIds(user.id));
  const parentClassIds = new Set(await getParentClassIds(user.id));

  return resources.filter((r) => userMatchesAssignmentRules(assignmentsByResource.get(r.id) || [], user, catechistClassIds, parentClassIds));
};

// Notifications a user hasn't dismissed yet, filtered to their audience — shown as
// banners on every page (see the per-request middleware and _topbar.ejs) until
// acknowledged via POST /notifications/:id/acknowledge.
const getVisibleNotificationsForUser = async (user) => {
  const notifications = await db.prepare(`
    SELECT n.* FROM notifications n
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_acknowledgements na WHERE na.notification_id = n.id AND na.user_id = ?
    )
    ORDER BY n.created_at DESC
  `).all(user.id);
  if (!notifications.length) return [];

  const assignments = await db.prepare('SELECT * FROM notification_assignments').all();
  const assignmentsByNotification = new Map();
  assignments.forEach((a) => {
    if (!assignmentsByNotification.has(a.notification_id)) assignmentsByNotification.set(a.notification_id, []);
    assignmentsByNotification.get(a.notification_id).push(a);
  });

  const catechistClassIds = new Set(await getCatechistClassIds(user.id));
  const parentClassIds = new Set(await getParentClassIds(user.id));

  return notifications.filter((n) => userMatchesAssignmentRules(assignmentsByNotification.get(n.id) || [], user, catechistClassIds, parentClassIds));
};

// When a school year's Faith Formation registration is closed, every currently-Enrolled
// student whose admission was for that year gets a permanent class-history entry (grade,
// class, and school year they completed), and that registration is archived — dropping
// them out of active views/class rosters. Their student record itself stays Enrolled
// (unchanged), ready for whenever they're registered again for the next year.
const rolloverEnrolledStudentsForSchoolYear = async (schoolYear) => {
  const rows = await db.prepare(`
    SELECT sr.id AS registration_id, s.id AS student_id, s.grade_level, s.preferred_class_time
    FROM student_registrations sr
    JOIN students s ON s.id = sr.student_id
    WHERE sr.school_year = ? AND sr.status = 'admitted' AND sr.archived_at IS NULL AND s.student_status = 'enrolled'
  `).all(schoolYear);

  if (!rows.length) return;

  const ccdClasses = await getCcdClasses();

  for (const row of rows) {
    const matchedClass = ccdClasses.find((c) => {
      if (c.grade_level !== row.grade_level) return false;
      if (!SACRAMENTAL_GRADE_LEVELS.has(c.grade_level)) return true;
      return row.preferred_class_time === c.class_time || row.preferred_class_time === getClassSlotValue(c);
    });

    await db.prepare(
      `INSERT INTO student_class_history (student_id, ccd_class_id, grade_level, school_year, class_time, classroom)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      row.student_id,
      matchedClass ? matchedClass.id : null,
      row.grade_level,
      schoolYear,
      matchedClass ? matchedClass.class_time : null,
      matchedClass ? matchedClass.classroom : null
    );

    await db.prepare('UPDATE student_registrations SET archived_at = NOW() WHERE id = ?').run(row.registration_id);
  }
};

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

// Explicit per-class schedule an admin/catechist manages by hand (see the
// ccd_class_session_dates table) — used instead of getUpcomingSessionDates' rolling
// 6-week guess once a class has any dates configured, since the real faith formation
// calendar has holiday/break exceptions a fixed weekly pattern can't represent.
const getClassSessionDates = async (classId, startDateValue = null, endDateValue = null) => {
  const rangeFilter = startDateValue && endDateValue ? ' AND session_date BETWEEN ? AND ?' : '';
  const params = startDateValue && endDateValue ? [classId, startDateValue, endDateValue] : [classId];
  const rows = await db.prepare(
    `SELECT session_date, description, event_type FROM ccd_class_session_dates WHERE ccd_class_id = ?${rangeFilter} ORDER BY session_date ASC`
  ).all(...params);
  return rows.map((row) => ({ date: new Date(row.session_date), description: row.description || '', eventType: row.event_type || 'class_day' }));
};

// Mirrors the class detail page's "next session" logic: prefer the real stored schedule
// over the rolling weekly guess once any dates have been configured for the class.
const getNextSessionDateForClass = async (classId, classTimeText) => {
  const storedSchedule = await getClassSessionDates(classId);
  const upcomingDates = storedSchedule.length ? storedSchedule.map((s) => s.date) : getUpcomingSessionDates(classTimeText);
  const today = formatSessionDateValue(new Date());
  return upcomingDates.find((d) => formatSessionDateValue(d) >= today) || upcomingDates[0] || null;
};

// Used to surface confirmed class days (across every class, not just one) on the
// shared /calendar page, so parents/staff can see them alongside other parish events.
const getClassSessionDatesInRange = async (startDateValue, endDateValue, classId = null) => {
  const classFilter = classId ? ' AND scd.ccd_class_id = ?' : '';
  const params = classId ? [startDateValue, endDateValue, classId] : [startDateValue, endDateValue];
  const rows = await db.prepare(`
    SELECT scd.session_date, scd.description, scd.event_type, cc.id AS classId, cc.class_time, cc.grade_level, cc.section_label AS sectionLabel
    FROM ccd_class_session_dates scd
    INNER JOIN ccd_classes cc ON cc.id = scd.ccd_class_id
    WHERE scd.session_date BETWEEN ? AND ?${classFilter}
  `).all(...params);

  const byDate = new Map();
  rows.forEach((row) => {
    const dateKey = formatSessionDateValue(new Date(row.session_date));
    if (!byDate.has(dateKey)) byDate.set(dateKey, { classTimes: new Set(), descriptions: new Set(), classes: [] });
    const entry = byDate.get(dateKey);
    if (row.class_time) entry.classTimes.add(row.class_time);
    if (row.description) entry.descriptions.add(row.description);
    entry.classes.push({
      classId: row.classId,
      className: `${CCD_GRADE_MEANINGS[row.grade_level] || row.grade_level}${row.sectionLabel || ''}`,
      classShortLabel: getCcdClassShortLabel({ grade_level: row.grade_level, sectionLabel: row.sectionLabel }),
      classTime: row.class_time || '',
      description: row.description || '',
      eventType: row.event_type || 'class_day',
    });
  });

  return byDate;
};

const generateWeeklyDatesInRange = (weekdayIndex, startDate, endDate) => {
  const cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() + ((weekdayIndex - cursor.getDay() + 7) % 7));
  const dates = [];
  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return dates;
};

// A student shows as a full roster member only once their registration has cleared the
// acceptance gate (conditionally_accepted or admitted); anything earlier — in_progress,
// incomplete, or otherwise — is still pending and shown as such in the class roster.
// (completed/graduated/etc. can no longer occur on a registration's own status — see
// the `students` table — so they're not part of this gate anymore.)
const CLASS_ROSTER_ACCEPTED_STATUSES = new Set(['conditionally_accepted', 'admitted']);
const isPendingAcceptance = (reg) => !CLASS_ROSTER_ACCEPTED_STATUSES.has(reg.status);
const getCatechists = async () =>
  db.prepare(`
    SELECT id, full_name, email
    FROM users
    WHERE role = 'catechist' AND COALESCE(account_status, 'active') <> 'deleted'
    ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC
  `).all();
// Admins sometimes also teach a class, so the class panel's teacher-assignment
// dropdown (unlike the catechist-only list above) offers both roles.
const getAssignableTeachers = async () =>
  db.prepare(`
    SELECT id, full_name, email
    FROM users
    WHERE role IN ('admin', 'catechist') AND COALESCE(account_status, 'active') <> 'deleted'
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

// Compact per-day grid (day number + hasClass flag only, no event details) for the
// printable year-at-a-glance view — same week-grid shape as buildCalendarWeeks but
// stripped down since a full 9-month page has no room for event text per cell.
const buildMiniMonthWeeks = (year, monthIndex, classDayDates, classWeekdays) => {
  const startOffset = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasClass = classDayDates.has(dateKey);
    const weekday = new Date(year, monthIndex, day).getDay();
    cells.push({ day, hasClass, isOffWeekday: !hasClass && classWeekdays && !classWeekdays.has(weekday) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let idx = 0; idx < cells.length; idx += 7) {
    weeks.push(cells.slice(idx, idx + 7));
  }
  return weeks;
};

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });

// Resource library files live outside the public /uploads static mount (see app.use
// below) — unlike certificates and other uploads, these need real per-user visibility
// checks at fetch time, not just an unguessable filename, so they're only ever served
// through the authenticated /resources/:id/download route.
const resourceUploadDir = path.join(uploadDir, 'resources');
fs.mkdirSync(resourceUploadDir, { recursive: true });

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
const messageAttachmentUpload = multer({
  storage,
  limits: {
    files: 5,
    fileSize: 10 * 1024 * 1024,
  },
});
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
const tuitionImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
const resourceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, resourceUploadDir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
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

// Powers the dismissible notification banners in _topbar.ejs, shown on every page a
// logged-in user hasn't yet acknowledged them on. Explicitly caught (not asyncHandler)
// and failed open to an empty list on error, since this runs on every single request and
// is decoration, not content the request is actually for — it shouldn't be able to take
// an unrelated page down.
app.use((req, res, next) => {
  if (!req.user) {
    res.locals.pendingNotifications = [];
    return next();
  }
  getVisibleNotificationsForUser(req.user)
    .then((notifications) => { res.locals.pendingNotifications = notifications; next(); })
    .catch(() => { res.locals.pendingNotifications = []; next(); });
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

      await db.prepare(`
        UPDATE users
        SET password_reset_token = ?,
            password_reset_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
        WHERE id = ?
      `).run(resetTokenHash, user.id);

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
    `SELECT id, account_status, password_reset_expires_at
     FROM users
     WHERE password_reset_token = ?
       AND password_reset_expires_at > UTC_TIMESTAMP()`
  ).get(tokenHash);

  if (!user || db.isDeletedAccount(user)) {
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
    `SELECT id, account_status, password_reset_expires_at
     FROM users
     WHERE password_reset_token = ?
       AND password_reset_expires_at > UTC_TIMESTAMP()`
  ).get(tokenHash);

  if (!user || db.isDeletedAccount(user)) {
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

  // Persistent student records (created once a registration is Admitted) outlive any one
  // year's registration, so parents see their kids here regardless of what's happened to
  // that original registration since.
  const myStudents = await db.prepare('SELECT * FROM students WHERE parent_user_id = ? ORDER BY student_full_name ASC').all(req.user.id);

  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  res.render('dashboard', { studentRegs, familyRegs, adultRegs, sponsorRegs, myStudents, ADULT_PROGRAMS, faithFormationSettings, resolveCcdGrade, feeBreakdown, totalFeesDue });
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
  const eventOccurrences = expandScheduledEventsForMonth(scheduledEvents, year, monthIndex);

  const monthEndDate = new Date(year, monthIndex + 1, 0);
  const classDaysByDate = await getClassSessionDatesInRange(
    formatSessionDateValue(monthStart),
    formatSessionDateValue(monthEndDate)
  );
  // One pill per class meeting that day (not one merged pill per date), so a parent or
  // catechist can see which specific class(es) have a session rather than a generic
  // "Faith Formation Classes" entry with every class's time/note run together.
  const classDayOccurrences = Array.from(classDaysByDate.entries()).flatMap(([dateKey, info]) =>
    // The grid's own weekday column already says "Tuesday" etc., so only the time range
    // is shown here — repeating the weekday on every pill would just be noise.
    info.classes.map((classInfo) => ({
      title: classInfo.classShortLabel,
      fullTitle: classInfo.className,
      occurrence_date: dateKey,
      event_time: splitClassTimeText(classInfo.classTime).timeRange,
      description: classInfo.description,
      eventType: classInfo.eventType,
      isClassDay: true,
    }))
  );

  const occurrences = [...classDayOccurrences, ...eventOccurrences];
  const weeks = buildCalendarWeeks(occurrences, year, monthIndex);

  res.render('calendar', {
    calendarMonthLabel: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    previousMonthParam: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`,
    nextMonthParam: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`,
    weeks,
    weekdayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthEvents: occurrences,
    ccdClassCodeLegend: CCD_GRADE_SHORT_CODE_LEGEND,
  });
}));

app.get('/calendar/year', requireAuth, asyncHandler(async (req, res) => {
  const faithFormationSettings = await getFaithFormationSettings();
  const requestedSchoolYear = typeof req.query.school_year === 'string' ? req.query.school_year.trim() : '';
  const schoolYear = /^\d{4}-\d{4}$/.test(requestedSchoolYear) ? requestedSchoolYear : faithFormationSettings.schoolYear;
  const startYear = parseFaithFormationStartYear(schoolYear);

  const classId = Number.parseInt(req.query.class_id, 10) || null;
  let className = '';
  if (classId) {
    const ccdClasses = await getCcdClasses();
    const ccdClass = ccdClasses.find((c) => c.id === classId);
    if (ccdClass) className = `${CCD_GRADE_MEANINGS[ccdClass.grade_level] || ccdClass.grade_level}${ccdClass.sectionLabel || ''}`;
  }

  const classDaysByDate = await getClassSessionDatesInRange(`${startYear}-09-01`, `${startYear + 1}-05-31`, classId);
  const classDayDates = new Set(classDaysByDate.keys());
  const classWeekdays = new Set(Array.from(classDayDates, (dateKey) => new Date(`${dateKey}T00:00:00`).getDay()));
  const localeTag = res.locals.lang === 'es' ? 'es-ES' : 'en-US';

  const months = Array.from({ length: 9 }, (_, offset) => {
    const monthOffset = 8 + offset; // September is month index 8
    const year = startYear + Math.floor(monthOffset / 12);
    const monthIndex = monthOffset % 12;
    return {
      label: new Date(year, monthIndex, 1).toLocaleDateString(localeTag, { month: 'long', year: 'numeric' }),
      weeks: buildMiniMonthWeeks(year, monthIndex, classDayDates, classWeekdays),
    };
  });

  res.render('calendar-year', {
    schoolYear,
    months,
    weekdayLabels: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    className,
  });
}));

app.get('/calendar/class/:id', requireAuth, asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClasses = await getCcdClasses();
  const ccdClass = ccdClasses.find((c) => c.id === classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/calendar');
  }

  const faithFormationSettings = await getFaithFormationSettings();
  const requestedSchoolYear = typeof req.query.school_year === 'string' ? req.query.school_year.trim() : '';
  const schoolYear = /^\d{4}-\d{4}$/.test(requestedSchoolYear) ? requestedSchoolYear : faithFormationSettings.schoolYear;
  const startYear = parseFaithFormationStartYear(schoolYear);

  const sessions = await getClassSessionDates(classId, `${startYear}-09-01`, `${startYear + 1}-05-31`);
  const localeTag = res.locals.lang === 'es' ? 'es-ES' : 'en-US';

  const monthGroups = [];
  let currentKey = null;
  sessions.forEach((session, index) => {
    const key = `${session.date.getFullYear()}-${session.date.getMonth()}`;
    if (key !== currentKey) {
      monthGroups.push({
        label: session.date.toLocaleDateString(localeTag, { month: 'long' }),
        year: session.date.getFullYear(),
        sessions: [],
      });
      currentKey = key;
    }
    monthGroups[monthGroups.length - 1].sessions.push({
      number: index + 1,
      value: formatSessionDateValue(session.date),
      day: session.date.getDate(),
      label: session.date.toLocaleDateString(localeTag, { weekday: 'short', day: 'numeric' }),
      description: session.description,
      eventType: session.eventType,
    });
  });

  const canEdit = req.user.role === 'admin' || (req.user.role === 'catechist' && isClassCatechist(ccdClass, req.user.id));

  const { weekday: classWeekdayText, timeRange: classTimeRangeText } = splitClassTimeText(ccdClass.class_time);

  res.render('calendar-class', {
    ccdClass,
    className: `${CCD_GRADE_MEANINGS[ccdClass.grade_level] || ccdClass.grade_level}${ccdClass.sectionLabel || ''}`,
    schoolYear,
    monthGroups,
    sessionCount: sessions.length,
    rangeLabel: sessions.length
      ? `${sessions[0].date.toLocaleDateString(localeTag, { month: 'long', year: 'numeric' })} – ${sessions[sessions.length - 1].date.toLocaleDateString(localeTag, { month: 'long', year: 'numeric' })}`
      : '',
    classWeekdayText,
    classTimeRangeText,
    canEdit,
    currentUrl: `/calendar/class/${classId}?school_year=${schoolYear}`,
    eventTypes: CLASS_SESSION_EVENT_TYPES,
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
  let prefillStudentId = null;

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
  } else if (stage === 'intro' && !groupIds.length && req.query.prefillStudentId) {
    // A parent starting a brand-new registration from one of their persistent student
    // records (e.g. "register for next year") — carry forward last year's household and
    // child details from that student's originating registration so they only have to
    // review and update what's changed, not retype everything.
    const prefillStudentId = Number.parseInt(req.query.prefillStudentId, 10);
    const prefillStudent = Number.isInteger(prefillStudentId)
      ? await db.prepare('SELECT * FROM students WHERE id = ? AND parent_user_id = ?').get(prefillStudentId, req.user.id)
      : null;

    if (prefillStudent) {
      const priorReg = prefillStudent.source_registration_id
        ? await db.prepare('SELECT * FROM student_registrations WHERE id = ?').get(prefillStudent.source_registration_id)
        : null;

      const prefill = {
        primary_contact_first_name: priorReg?.primary_contact_first_name,
        primary_contact_last_name: priorReg?.primary_contact_last_name,
        primary_contact_phone: priorReg?.primary_contact_phone || prefillStudent.primary_contact_phone,
        primary_contact_email: priorReg?.primary_contact_email || prefillStudent.primary_contact_email,
        primary_contact_relationship: priorReg?.primary_contact_relationship,
        primary_contact_relationship_other: priorReg?.primary_contact_relationship_other,
        primary_contact_religion: priorReg?.primary_contact_religion,
        address: priorReg?.address,
        city_state_zip: priorReg?.city_state_zip,
        father_name: priorReg?.father_name,
        father_religion: priorReg?.father_religion,
        father_cell: priorReg?.father_cell,
        mother_maiden_name: priorReg?.mother_maiden_name,
        mother_religion: priorReg?.mother_religion,
        mother_cell: priorReg?.mother_cell,
        child_lives_with: priorReg?.child_lives_with,
        step_parent_name: priorReg?.step_parent_name,
        step_parent_religion: priorReg?.step_parent_religion,
        parent_signature: priorReg?.parent_signature,
        email: priorReg?.email,
        student_full_name: prefillStudent.student_full_name,
        student_gender: prefillStudent.student_gender,
        student_dob: prefillStudent.student_dob,
        child_place_of_birth_city: priorReg?.child_place_of_birth_city,
        child_place_of_birth_country: priorReg?.child_place_of_birth_country,
        ccd_grade_level: priorReg?.ccd_grade_level,
        school_grade_level: priorReg?.school_grade_level,
        school_attending: priorReg?.school_attending,
        not_baptized: priorReg?.not_baptized,
        baptism_date: priorReg?.baptism_date,
        baptism_church: priorReg?.baptism_church,
        first_communion_date: priorReg?.first_communion_date,
        first_communion_church: priorReg?.first_communion_church,
        sacramental_year: priorReg?.sacramental_year,
        preferred_class_time: prefillStudent.preferred_class_time,
        non_sacramental_grade: priorReg?.non_sacramental_grade,
        disabilities_comments: priorReg?.disabilities_comments,
        // Certificates aren't carried over — they belong to the prior registration's own
        // uploads, so the parent re-attaches them here rather than the new registration
        // pointing at another row's files.
        baptism_certificate_path: null,
        first_communion_certificate_path: null,
      };
      const addressParts = prefill.city_state_zip ? prefill.city_state_zip.split(', ') : ['', '', ''];
      prefill.city = addressParts[0] || '';
      prefill.state = addressParts[1] ? addressParts[1].split(' ')[0] : '';
      prefill.zip = addressParts[1] ? addressParts[1].split(' ')[1] : '';

      parentInfo = prefill;
      studentPrefill = prefill;
      prefillStudentId = prefillStudent.id;
    }
  }

  res.render('registration-form', {
    today,
    reg: parentInfo,
    editing: false,
    isStaff: false,
    schoolYearLabel: `${res.locals.t('school_year')} ${faithFormationSettings.schoolYear}`,
    activeSchoolYear: faithFormationSettings.schoolYear,
    statusOptions: CHILD_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['children', 'general']),
    stage,
    totalChildren,
    studentIndex,
    groupIds,
    parentInfo,
    studentPrefill,
    currentRegistrationId,
    prefillStudentId,
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

const SACRAMENT_NEED_BY_SACRAMENTAL_YEAR = {
  first_year_communion: 'first_holy_communion',
  first_year_confirmation: 'confirmation',
};

// Reuses the existing Family Faith Formation household registration instead of building a
// separate parent-class concept — auto-creates or updates the family's FFF row so they show
// up for a visit to be scheduled, without needing the (admin-gated) FFF start flow. Safe to
// call on every save: matches the child by name+dob and no-ops if already recorded.
const autoEnrollFamilyFaithFormation = async ({
  userId, schoolYear, sacramentalYear,
  childFirstName, childLastName, childDob,
  parentFirstName, parentLastName, parentEmail, parentPhone,
}) => {
  const sacramentNeed = SACRAMENT_NEED_BY_SACRAMENTAL_YEAR[sacramentalYear];
  if (!sacramentNeed || !userId) return;

  const existing = await db.prepare(
    'SELECT id, members_json FROM family_faith_registrations WHERE user_id = ? AND school_year = ?'
  ).get(userId, schoolYear);

  const members = existing ? normalizeFamilyMembers(safeJsonParse(existing.members_json, [])) : [];

  const sameChild = (m) => m.role === 'child'
    && (m.firstName || '').toLowerCase() === (childFirstName || '').toLowerCase()
    && (m.lastName || '').toLowerCase() === (childLastName || '').toLowerCase()
    && (m.dob || '') === (childDob || '');
  const child = members.find(sameChild);
  if (child) {
    if (!child.sacramentNeeds.includes(sacramentNeed)) child.sacramentNeeds = [...child.sacramentNeeds, sacramentNeed];
  } else {
    members.push({ firstName: childFirstName, lastName: childLastName, role: 'child', dob: childDob, notes: null, sacramentNeeds: [sacramentNeed] });
  }

  const sameParent = (m) => m.role === 'parent'
    && (m.firstName || '').toLowerCase() === (parentFirstName || '').toLowerCase()
    && (m.lastName || '').toLowerCase() === (parentLastName || '').toLowerCase();
  if (parentFirstName && parentLastName && !members.some(sameParent)) {
    members.push({ firstName: parentFirstName, lastName: parentLastName, role: 'parent', dob: null, notes: null, sacramentNeeds: [] });
  }

  const membersJson = JSON.stringify(members);
  if (existing) {
    await db.prepare('UPDATE family_faith_registrations SET members_json = ? WHERE id = ?').run(membersJson, existing.id);
  } else {
    const familyName = parentLastName ? `${parentLastName} Family` : (childLastName ? `${childLastName} Family` : 'Family');
    await db.prepare(`
      INSERT INTO family_faith_registrations
        (user_id, school_year, family_name, primary_contact_name, primary_contact_email, primary_contact_phone, members_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress')
    `).run(
      userId, schoolYear, familyName,
      [parentFirstName, parentLastName].filter(Boolean).join(' ') || null,
      parentEmail || null, parentPhone || null, membersJson
    );
  }
};

const handleChildrenRegistration = asyncHandler(async (req, res) => {
    const faithFormationSettings = await requireRegistrationAccess(req, res, 'faith_formation');
    if (!faithFormationSettings) return;
    const isAdmin = req.user.role === 'admin';
    const orNull = (v) => (v === undefined || v === '' ? null : v);
    const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
    if (requestedStatus && !CHILD_REGISTRATION_STATUSES.includes(requestedStatus)) {
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
      // "Register for Next Year" pre-fills a brand-new registration from an existing
      // persistent student — carry that link forward on the row it creates so admission
      // updates the same student record instead of minting a second one. Re-validated
      // here (not just trusted from the hidden field) since it's client-controllable.
      let linkedStudentId = null;
      if (!existingRowId) {
        const rawPrefillStudentId = Number.parseInt(req.body.prefill_student_id, 10);
        if (Number.isInteger(rawPrefillStudentId)) {
          const linkedStudent = await db.prepare(
            'SELECT id FROM students WHERE id = ? AND (parent_user_id = ? OR ? = 1)'
          ).get(rawPrefillStudentId, registrationOwnerUserId, isAdmin ? 1 : 0);
          linkedStudentId = linkedStudent ? linkedStudent.id : null;
        }
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

        // Keep the persistent student record's own copy of certificates/comments in sync
        // with the registration whenever it's edited, so that data survives independent
        // of what later happens to this registration row.
        const registrationForStudentSync = await db.prepare(
          'SELECT student_id, baptism_certificate_path, first_communion_certificate_path, disabilities_comments FROM student_registrations WHERE id = ?'
        ).get(existingRowId);
        if (registrationForStudentSync?.student_id) {
          await db.prepare(
            'UPDATE students SET baptism_certificate_path = ?, first_communion_certificate_path = ?, disabilities_comments = ? WHERE id = ?'
          ).run(
            registrationForStudentSync.baptism_certificate_path,
            registrationForStudentSync.first_communion_certificate_path,
            registrationForStudentSync.disabilities_comments,
            registrationForStudentSync.student_id
          );
        }
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
            baptism_certificate_path, first_communion_certificate_path, status, student_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          linkedStudentId,
        );
        thisRowId = result.lastInsertRowid;
      }

      const groupIdsAfter = existingRowId ? priorGroupIds : [...priorGroupIds, thisRowId];

      const enrolledInFamilyFaith = !!SACRAMENT_NEED_BY_SACRAMENTAL_YEAR[req.body.sacramental_year];
      await autoEnrollFamilyFaithFormation({
        userId: registrationOwnerUserId,
        schoolYear: faithFormationSettings.schoolYear,
        sacramentalYear: req.body.sacramental_year || null,
        childFirstName: firstName,
        childLastName: lastName,
        childDob: dob,
        parentFirstName: orNull(req.body.primary_contact_first_name),
        parentLastName: orNull(req.body.primary_contact_last_name),
        parentEmail: orNull(req.body.primary_contact_email),
        parentPhone: orNull(req.body.primary_contact_phone),
      });

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
        const familyFaithNote = enrolledInFamilyFaith
          ? ' Your family has also been enrolled in Family Faith Formation — visit your dashboard to schedule your family visit.'
          : '';
        req.flash('success', `Registration submitted. Total fees: $${totalFeesCharged}.${familyFaithNote}`);
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
      'SELECT id, user_id, status, baptism_certificate_path, first_communion_certificate_path FROM student_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
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

    await autoEnrollFamilyFaithFormation({
      userId: existingReg.user_id,
      schoolYear: faithFormationSettings.schoolYear,
      sacramentalYear: req.body.sacramental_year || null,
      childFirstName: (req.body.student_first_name || '').trim(),
      childLastName: (req.body.student_last_name || '').trim(),
      childDob: orNull(req.body.student_dob),
      parentFirstName: orNull(req.body.primary_contact_first_name),
      parentLastName: orNull(req.body.primary_contact_last_name),
      parentEmail: orNull(req.body.primary_contact_email),
      parentPhone: orNull(req.body.primary_contact_phone),
    });

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
  const defaultRedirect = `/registration/children/edit/${req.params.id}`;
  const redirectTo = typeof req.body.redirect_to === 'string' && req.body.redirect_to.startsWith('/admin/registrations')
    ? req.body.redirect_to
    : defaultRedirect;

  const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  if (!CHILD_REGISTRATION_STATUSES.includes(requestedStatus)) {
    req.flash('error', 'Invalid registration status.');
    return res.redirect(redirectTo);
  }

  const reg = await db.prepare('SELECT * FROM student_registrations WHERE id = ?').get(req.params.id);
  if (!reg) {
    return res.status(404).send('Registration not found.');
  }

  if (requestedStatus === 'admitted') {
    const missingFields = getIncompleteStudentRegistrationFields(reg);
    if (missingFields.length) {
      req.flash('error', `Cannot mark this registration admitted until all required fields are filled in. Missing: ${missingFields.join(', ')}.`);
      return res.redirect(redirectTo);
    }
  }

  await db.prepare('UPDATE student_registrations SET status = ? WHERE id = ?').run(requestedStatus, req.params.id);

  // Admission creates (or, for a returning student registered via "Register for Next
  // Year", updates) the persistent student record, so a student's identity and history
  // survive across years instead of getting a new row every time they re-register.
  if (requestedStatus === 'admitted') {
    if (reg.student_id) {
      await db.prepare(
        `UPDATE students SET
           student_full_name = ?, student_dob = ?, student_gender = ?, grade_level = ?, preferred_class_time = ?,
           parent_name = ?, primary_contact_email = ?, primary_contact_phone = ?,
           baptism_certificate_path = ?, first_communion_certificate_path = ?, disabilities_comments = ?,
           certificates_verified = ?, certificates_verified_at = ?, certificates_verified_by = ?,
           tuition_paid = ?, tuition_paid_at = ?, tuition_paid_by = ?,
           tuition_amount_paid = ?, tuition_transaction_id = ?, tuition_payment_method = ?,
           parent_contacted = ?, parent_contacted_at = ?, parent_contacted_by = ?,
           student_status = 'enrolled', source_registration_id = ?
         WHERE id = ?`
      ).run(
        reg.student_full_name, reg.student_dob, reg.student_gender, resolveCcdGrade(reg), reg.preferred_class_time,
        reg.parent_name, reg.primary_contact_email, reg.primary_contact_phone,
        reg.baptism_certificate_path, reg.first_communion_certificate_path, reg.disabilities_comments,
        reg.certificates_verified, reg.certificates_verified_at, reg.certificates_verified_by,
        reg.tuition_paid, reg.tuition_paid_at, reg.tuition_paid_by,
        reg.tuition_amount_paid, reg.tuition_transaction_id, reg.tuition_payment_method,
        reg.parent_contacted, reg.parent_contacted_at, reg.parent_contacted_by,
        reg.id, reg.student_id
      );
    } else {
      const created = await db.prepare(
        `INSERT INTO students (
           student_full_name, student_dob, student_gender, grade_level, preferred_class_time,
           parent_user_id, parent_name, primary_contact_email, primary_contact_phone,
           baptism_certificate_path, first_communion_certificate_path, disabilities_comments,
           certificates_verified, certificates_verified_at, certificates_verified_by,
           tuition_paid, tuition_paid_at, tuition_paid_by,
           tuition_amount_paid, tuition_transaction_id, tuition_payment_method,
           parent_contacted, parent_contacted_at, parent_contacted_by,
           student_status, source_registration_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enrolled', ?)`
      ).run(
        reg.student_full_name, reg.student_dob, reg.student_gender, resolveCcdGrade(reg), reg.preferred_class_time,
        reg.user_id, reg.parent_name, reg.primary_contact_email, reg.primary_contact_phone,
        reg.baptism_certificate_path, reg.first_communion_certificate_path, reg.disabilities_comments,
        reg.certificates_verified, reg.certificates_verified_at, reg.certificates_verified_by,
        reg.tuition_paid, reg.tuition_paid_at, reg.tuition_paid_by,
        reg.tuition_amount_paid, reg.tuition_transaction_id, reg.tuition_payment_method,
        reg.parent_contacted, reg.parent_contacted_at, reg.parent_contacted_by,
        reg.id
      );
      await db.prepare('UPDATE student_registrations SET student_id = ? WHERE id = ?').run(created.lastInsertRowid, req.params.id);
    }
  }

  req.flash('success', res.locals.t('status_updated'));
  return res.redirect(redirectTo);
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
    statusOptions: CHILD_REGISTRATION_STATUSES,
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
    statusOptions: FAMILY_FAITH_REGISTRATION_STATUSES,
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

  if (requestedStatus && !FAMILY_FAITH_REGISTRATION_STATUSES.includes(requestedStatus)) {
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
  const defaultRedirect = `/registration/family-faith/edit/${req.params.id}`;
  const redirectTo = typeof req.body.redirect_to === 'string' && req.body.redirect_to.startsWith('/admin/registrations')
    ? req.body.redirect_to
    : defaultRedirect;

  const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  if (!FAMILY_FAITH_REGISTRATION_STATUSES.includes(requestedStatus)) {
    req.flash('error', 'Invalid registration status.');
    return res.redirect(redirectTo);
  }

  const reg = await db.prepare('SELECT id FROM family_faith_registrations WHERE id = ?').get(req.params.id);
  if (!reg) return res.status(404).send('Registration not found.');

  await db.prepare('UPDATE family_faith_registrations SET status = ? WHERE id = ?').run(requestedStatus, req.params.id);
  req.flash('success', res.locals.t('status_updated'));
  return res.redirect(redirectTo);
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
    statusOptions: FAMILY_FAITH_REGISTRATION_STATUSES,
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

  const registration = await db.prepare('SELECT id, student_id FROM student_registrations WHERE id = ?').get(registrationId);
  if (!registration) {
    return res.status(404).json({ ok: false, error: 'Registration not found.' });
  }

  const atCol = `${field}_at`;
  const byCol = `${field}_by`;

  if (checked) {
    await db.prepare(
      `UPDATE student_registrations SET \`${field}\` = 1, \`${atCol}\` = CURRENT_TIMESTAMP, \`${byCol}\` = ? WHERE id = ?`
    ).run(req.user.id, registrationId);
    if (registration.student_id) {
      await db.prepare(
        `UPDATE students SET \`${field}\` = 1, \`${atCol}\` = CURRENT_TIMESTAMP, \`${byCol}\` = ? WHERE id = ?`
      ).run(req.user.id, registration.student_id);
    }
  } else {
    await db.prepare(
      `UPDATE student_registrations SET \`${field}\` = 0, \`${atCol}\` = NULL, \`${byCol}\` = NULL WHERE id = ?`
    ).run(registrationId);
    if (registration.student_id) {
      await db.prepare(
        `UPDATE students SET \`${field}\` = 0, \`${atCol}\` = NULL, \`${byCol}\` = NULL WHERE id = ?`
      ).run(registration.student_id);
    }
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

const EXPORT_REGISTRATION_TYPES = new Set(['child', 'family_faith', 'adult', 'sponsor_confirmation']);
const REGISTRATION_TYPE_STATUS_OPTIONS = {
  child: ['all', 'active', ...CHILD_REGISTRATION_STATUSES, 'archived'],
  family_faith: ['all', ...FAMILY_FAITH_REGISTRATION_STATUSES],
  adult: ['all', 'active', 'archived'],
  sponsor_confirmation: ['all', 'incomplete', 'in_progress'],
};
const REGISTRATION_TYPE_DEFAULT_STATUS = {
  child: 'in_progress',
  family_faith: 'in_progress',
  adult: 'active',
  sponsor_confirmation: 'in_progress',
};

app.get('/admin/registrations/export.csv', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const gradeFilter = Object.keys(CCD_GRADE_MEANINGS).includes(req.query.grade) ? req.query.grade : '';
  const parentFilter = typeof req.query.parent === 'string' ? req.query.parent.trim() : '';
  const typeFilter = EXPORT_REGISTRATION_TYPES.has(req.query.type) ? req.query.type : '';

  const includeChild = !typeFilter || typeFilter === 'child';
  const includeFamily = !typeFilter || typeFilter === 'family_faith';
  const includeAdult = !typeFilter || typeFilter === 'adult';
  const includeSponsor = !typeFilter || typeFilter === 'sponsor_confirmation';

  const [studentRegsAll, familyRegs, adultRegs, sponsorRegs] = await Promise.all([
    includeChild ? db.prepare('SELECT * FROM student_registrations ORDER BY created_at DESC').all() : [],
    includeFamily ? db.prepare('SELECT * FROM family_faith_registrations ORDER BY created_at DESC').all() : [],
    includeAdult ? db.prepare('SELECT * FROM adult_registrations ORDER BY created_at DESC').all() : [],
    includeSponsor ? db.prepare('SELECT * FROM sponsor_confirmations ORDER BY created_at DESC').all() : [],
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
  const filenamePart = typeFilter ? `-${typeFilter}` : '';

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="registrations${filenamePart}-${dateStamp}.csv"`,
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

  const typeFilter = EXPORT_REGISTRATION_TYPES.has(req.query.type) ? req.query.type : 'child';
  const statusOptionsForType = REGISTRATION_TYPE_STATUS_OPTIONS[typeFilter];
  const requestedStatus = typeof req.query.status === 'string' ? req.query.status : '';
  const statusFilter = statusOptionsForType.includes(requestedStatus) ? requestedStatus : REGISTRATION_TYPE_DEFAULT_STATUS[typeFilter];

  const gradeFilter = typeFilter === 'child' && Object.keys(CCD_GRADE_MEANINGS).includes(req.query.grade) ? req.query.grade : '';
  const parentFilter = typeFilter === 'child' && typeof req.query.parent === 'string' ? req.query.parent.trim() : '';

  const sortableColumnsForType = typeFilter === 'child' ? new Set(['grade', 'submitted']) : new Set(['submitted']);
  const requestedSort = typeof req.query.sort === 'string' ? req.query.sort : '';
  const sortBy = sortableColumnsForType.has(requestedSort) ? requestedSort : '';
  const sortDir = req.query.dir === 'asc' ? 'asc' : 'desc';

  const computeStatusCounts = (rows, options) => {
    const counts = {};
    options.forEach((opt) => {
      if (opt === 'all') counts[opt] = rows.length;
      else if (opt === 'active') counts[opt] = rows.filter((r) => !r.archived_at).length;
      else if (opt === 'archived') counts[opt] = rows.filter((r) => !!r.archived_at).length;
      else counts[opt] = rows.filter((r) => r.status === opt).length;
    });
    return counts;
  };

  let studentRegs = [];
  let familyRegs = [];
  let adultRegs = [];
  let sponsorRegs = [];
  let statusCounts = {};

  if (typeFilter === 'child') {
    const allRegs = await db.prepare('SELECT * FROM student_registrations ORDER BY created_at DESC').all();
    statusCounts = computeStatusCounts(allRegs, statusOptionsForType);
    studentRegs = allRegs.filter((reg) => {
      if (statusFilter === 'active' && reg.archived_at) return false;
      if (statusFilter === 'archived' && !reg.archived_at) return false;
      if (CHILD_REGISTRATION_STATUSES.includes(statusFilter) && reg.status !== statusFilter) return false;
      if (gradeFilter && resolveCcdGrade(reg) !== gradeFilter) return false;
      if (parentFilter) {
        const needle = parentFilter.toLowerCase();
        const haystack = `${reg.parent_name || ''} ${reg.primary_contact_email || ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  } else if (typeFilter === 'family_faith') {
    const familyRegsRaw = await db.prepare('SELECT * FROM family_faith_registrations ORDER BY created_at DESC').all();
    statusCounts = computeStatusCounts(familyRegsRaw, statusOptionsForType);
    familyRegs = familyRegsRaw
      .filter((reg) => statusFilter === 'all' || reg.status === statusFilter)
      .map((reg) => ({ ...reg, members: parseFamilyMembersFromStorage(reg.members_json) }));
  } else if (typeFilter === 'adult') {
    const allRegs = await db.prepare('SELECT * FROM adult_registrations ORDER BY created_at DESC').all();
    statusCounts = computeStatusCounts(allRegs, statusOptionsForType);
    adultRegs = allRegs.filter((reg) => {
      if (statusFilter === 'active') return !reg.archived_at;
      if (statusFilter === 'archived') return !!reg.archived_at;
      return true;
    });
  } else if (typeFilter === 'sponsor_confirmation') {
    const allRegs = await db.prepare('SELECT * FROM sponsor_confirmations ORDER BY created_at DESC').all();
    statusCounts = computeStatusCounts(allRegs, statusOptionsForType);
    sponsorRegs = allRegs.filter((reg) => statusFilter === 'all' || reg.status === statusFilter);
  }

  if (sortBy) {
    const applySort = (rows) => {
      const sorted = [...rows];
      if (sortBy === 'submitted') {
        sorted.sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return sortDir === 'asc' ? aTime - bTime : bTime - aTime;
        });
      } else if (sortBy === 'grade') {
        sorted.sort((a, b) => {
          const aGrade = Number(resolveCcdGrade(a)) || null;
          const bGrade = Number(resolveCcdGrade(b)) || null;
          if (!aGrade && !bGrade) return 0;
          if (!aGrade) return 1;
          if (!bGrade) return -1;
          return sortDir === 'asc' ? aGrade - bGrade : bGrade - aGrade;
        });
      }
      return sorted;
    };
    studentRegs = applySort(studentRegs);
    familyRegs = applySort(familyRegs);
    adultRegs = applySort(adultRegs);
    sponsorRegs = applySort(sponsorRegs);
  }

  const filteredCount = studentRegs.length + familyRegs.length + adultRegs.length + sponsorRegs.length;

  const [childCountRow, familyCountRow, adultCountRow, sponsorCountRow] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS c FROM student_registrations').get(),
    db.prepare('SELECT COUNT(*) AS c FROM family_faith_registrations').get(),
    db.prepare('SELECT COUNT(*) AS c FROM adult_registrations').get(),
    db.prepare('SELECT COUNT(*) AS c FROM sponsor_confirmations').get(),
  ]);
  const typeCounts = {
    child: childCountRow.c,
    family_faith: familyCountRow.c,
    adult: adultCountRow.c,
    sponsor_confirmation: sponsorCountRow.c,
  };
  const grandTotal = typeCounts.child + typeCounts.family_faith + typeCounts.adult + typeCounts.sponsor_confirmation;

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

  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  res.render('admin-registrations', {
    typeFilter, statusFilter, statusOptionsForType, statusCounts, typeCounts, grandTotal, filteredCount,
    studentRegs, familyRegs, adultRegs, sponsorRegs, ADULT_PROGRAMS, faithFormationSettings,
    resolveCcdGrade, ccdGradeMeanings: CCD_GRADE_MEANINGS, gradeFilter, parentFilter, verifierLookup,
    sortBy, sortDir,
    childRegistrationStatuses: CHILD_REGISTRATION_STATUSES, familyFaithRegistrationStatuses: FAMILY_FAITH_REGISTRATION_STATUSES,
  });
}));

app.get('/admin/students', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const students = await db.prepare(`
    SELECT
      s.*,
      sr.id AS registration_id,
      sr.status AS registration_status,
      sr.registration_fee, sr.sacramental_fee, sr.late_fee,
      COALESCE(sr.baptism_certificate_path, s.baptism_certificate_path) AS baptism_certificate_path,
      COALESCE(sr.first_communion_certificate_path, s.first_communion_certificate_path) AS first_communion_certificate_path,
      COALESCE(sr.disabilities_comments, s.disabilities_comments) AS disabilities_comments,
      COALESCE(sr.certificates_verified, s.certificates_verified) AS certificates_verified,
      COALESCE(sr.certificates_verified_at, s.certificates_verified_at) AS certificates_verified_at,
      COALESCE(sr.certificates_verified_by, s.certificates_verified_by) AS certificates_verified_by,
      COALESCE(sr.tuition_paid, s.tuition_paid) AS tuition_paid,
      COALESCE(sr.tuition_paid_at, s.tuition_paid_at) AS tuition_paid_at,
      COALESCE(sr.tuition_paid_by, s.tuition_paid_by) AS tuition_paid_by,
      COALESCE(sr.tuition_amount_paid, s.tuition_amount_paid) AS tuition_amount_paid,
      COALESCE(sr.tuition_transaction_id, s.tuition_transaction_id) AS tuition_transaction_id,
      COALESCE(sr.tuition_payment_method, s.tuition_payment_method) AS tuition_payment_method,
      COALESCE(sr.parent_contacted, s.parent_contacted) AS parent_contacted,
      COALESCE(sr.parent_contacted_at, s.parent_contacted_at) AS parent_contacted_at,
      COALESCE(sr.parent_contacted_by, s.parent_contacted_by) AS parent_contacted_by,
      COALESCE(sr.is_altar_server, s.is_altar_server) AS is_altar_server
    FROM students s
    LEFT JOIN student_registrations sr ON sr.id = s.source_registration_id
    ORDER BY s.student_full_name ASC
  `).all();

  const studentIds = students.map((s) => s.id);
  let registrationHistoryByStudent = {};
  let classHistoryByStudent = {};
  if (studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    const registrationHistoryRows = await db.prepare(
      `SELECT id, student_id, school_year, status, ccd_grade_level, non_sacramental_grade, sacramental_year,
              not_baptized, baptism_date, baptism_church, first_communion_date, first_communion_church, created_at
       FROM student_registrations
       WHERE student_id IN (${placeholders})
       ORDER BY school_year DESC, created_at DESC`
    ).all(...studentIds);
    const classHistoryRows = await db.prepare(
      `SELECT student_id, school_year, grade_level, class_time, classroom, completed_at
       FROM student_class_history
       WHERE student_id IN (${placeholders})
       ORDER BY school_year DESC`
    ).all(...studentIds);

    registrationHistoryRows.forEach((row) => {
      (registrationHistoryByStudent[row.student_id] ||= []).push({ ...row, resolvedGrade: resolveCcdGrade(row) });
    });
    classHistoryRows.forEach((row) => {
      (classHistoryByStudent[row.student_id] ||= []).push(row);
    });
  }

  const faithFormationSettings = await getFaithFormationSettings();

  students.forEach((s) => {
    const registrationHistory = registrationHistoryByStudent[s.id] || [];
    const classHistory = classHistoryByStudent[s.id] || [];
    const closedYears = new Set(classHistory.map((c) => c.school_year));

    s.registrationHistory = registrationHistory;
    s.classHistory = classHistory.map((c) => ({ ...c, inProgress: false }))
      .concat(
        registrationHistory
          .filter((r) => r.school_year === faithFormationSettings.schoolYear && r.status !== 'cancelled' && !closedYears.has(r.school_year))
          .map((r) => ({ school_year: r.school_year, grade_level: r.resolvedGrade, class_time: null, classroom: null, completed_at: null, inProgress: true }))
      )
      .sort((a, b) => (a.school_year < b.school_year ? 1 : -1));

    const baptismRecord = registrationHistory.find((r) => !r.not_baptized && r.baptism_date);
    const communionRecord = registrationHistory.find((r) => r.first_communion_date);
    s.sacraments = {
      baptism: baptismRecord ? { date: baptismRecord.baptism_date, church: baptismRecord.baptism_church } : null,
      firstCommunion: communionRecord ? { date: communionRecord.first_communion_date, church: communionRecord.first_communion_church } : null,
      confirmationDate: s.confirmation_received_date,
    };
  });

  // Payments are recorded per student/registration (a "Family" payment tier
  // still gets its full amount recorded against each covered child, not
  // split), so a family's full payment picture only shows up by grouping
  // siblings together — same parent_user_id — rather than looking at one
  // student in isolation.
  const familyGroups = {};
  students.forEach((s) => {
    const key = s.parent_user_id || `solo-${s.id}`;
    (familyGroups[key] ||= []).push(s);
  });
  students.forEach((s) => {
    const key = s.parent_user_id || `solo-${s.id}`;
    s.familyPayments = familyGroups[key].map((sibling) => ({
      id: sibling.id,
      studentFullName: sibling.student_full_name,
      tuitionPaid: !!sibling.tuition_paid,
      amount: sibling.tuition_amount_paid,
      method: sibling.tuition_payment_method,
      transactionId: sibling.tuition_transaction_id,
      paidAt: sibling.tuition_paid_at,
      isSelf: sibling.id === s.id,
    }));
  });

  const totalCount = students.length;

  const statusOptionsForStudents = ['all', ...STUDENT_STATUSES];
  const requestedStatus = typeof req.query.status === 'string' ? req.query.status : '';
  const statusFilter = statusOptionsForStudents.includes(requestedStatus) ? requestedStatus : 'all';
  const gradeFilter = Object.keys(CCD_GRADE_MEANINGS).includes(req.query.grade) ? req.query.grade : '';
  const parentFilter = typeof req.query.parent === 'string' ? req.query.parent.trim() : '';

  const statusCounts = {};
  statusOptionsForStudents.forEach((opt) => {
    statusCounts[opt] = opt === 'all' ? students.length : students.filter((s) => s.student_status === opt).length;
  });

  let visibleStudents = students.filter((s) => {
    if (statusFilter !== 'all' && s.student_status !== statusFilter) return false;
    if (gradeFilter && s.grade_level !== gradeFilter) return false;
    if (parentFilter) {
      const needle = parentFilter.toLowerCase();
      const haystack = `${s.parent_name || ''} ${s.primary_contact_email || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const sortableColumns = new Set(['grade', 'submitted']);
  const requestedSort = typeof req.query.sort === 'string' ? req.query.sort : '';
  const sortBy = sortableColumns.has(requestedSort) ? requestedSort : '';
  const sortDir = req.query.dir === 'asc' ? 'asc' : 'desc';
  if (sortBy === 'grade') {
    visibleStudents = [...visibleStudents].sort((a, b) => {
      const aGrade = Number(a.grade_level) || null;
      const bGrade = Number(b.grade_level) || null;
      if (!aGrade && !bGrade) return 0;
      if (!aGrade) return 1;
      if (!bGrade) return -1;
      return sortDir === 'asc' ? aGrade - bGrade : bGrade - aGrade;
    });
  } else if (sortBy === 'submitted') {
    visibleStudents = [...visibleStudents].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortDir === 'asc' ? aTime - bTime : bTime - aTime;
    });
  }

  const verifierUserIds = new Set();
  visibleStudents.forEach((s) => {
    ['certificates_verified_by', 'tuition_paid_by', 'parent_contacted_by', 'confirmation_received_by'].forEach((col) => {
      if (s[col]) verifierUserIds.add(Number(s[col]));
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

  res.render('admin-students', {
    students: visibleStudents, verifierLookup, studentStatusOptions: STUDENT_STATUSES,
    statusOptionsForStudents, statusFilter, statusCounts, gradeFilter, parentFilter,
    ccdGradeMeanings: CCD_GRADE_MEANINGS, sortBy, sortDir, totalCount, filteredCount: visibleStudents.length,
  });
}));

app.post('/admin/students/:id/confirmation', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const student = await db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!student) {
    return res.status(404).send('Student not found.');
  }

  const clearRequested = req.body.clear_confirmation === '1';
  const requestedDate = clearRequested
    ? ''
    : (typeof req.body.confirmation_received_date === 'string' ? req.body.confirmation_received_date.trim() : '');
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    req.flash('error', 'Invalid confirmation date.');
    return res.redirect('/admin/students');
  }

  if (requestedDate) {
    await db.prepare('UPDATE students SET confirmation_received_date = ?, confirmation_received_by = ? WHERE id = ?')
      .run(requestedDate, req.user.id, req.params.id);
  } else {
    await db.prepare('UPDATE students SET confirmation_received_date = NULL, confirmation_received_by = NULL WHERE id = ?')
      .run(req.params.id);
  }

  req.flash('success', res.locals.t('status_updated'));
  return res.redirect('/admin/students');
}));

const TUITION_PAYMENT_METHODS = new Set(['cash', 'credit_card']);

app.post('/admin/students/:id/payment', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const student = await db.prepare('SELECT id, source_registration_id FROM students WHERE id = ?').get(req.params.id);
  if (!student) {
    return res.status(404).send('Student not found.');
  }

  const amount = parseTuitionImportAmount(req.body.amount);
  const method = typeof req.body.method === 'string' ? req.body.method.trim() : '';
  if (!amount || amount <= 0 || !TUITION_PAYMENT_METHODS.has(method)) {
    req.flash('error', 'Enter a valid payment amount and method.');
    return res.redirect('/admin/students');
  }

  const requestedDate = typeof req.body.payment_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.payment_date.trim())
    ? req.body.payment_date.trim()
    : new Date().toISOString().slice(0, 10);

  await db.prepare(
    `UPDATE students SET
       tuition_paid = 1, tuition_paid_at = ?, tuition_paid_by = ?,
       tuition_amount_paid = ?, tuition_transaction_id = NULL, tuition_payment_method = ?
     WHERE id = ?`
  ).run(requestedDate, req.user.id, amount, method, req.params.id);

  if (student.source_registration_id) {
    await db.prepare(
      `UPDATE student_registrations SET
         tuition_paid = 1, tuition_paid_at = ?, tuition_paid_by = ?,
         tuition_amount_paid = ?, tuition_transaction_id = NULL, tuition_payment_method = ?
       WHERE id = ?`
    ).run(requestedDate, req.user.id, amount, method, student.source_registration_id);
  }

  req.flash('success', res.locals.t('status_updated'));
  return res.redirect(`/admin/students/${req.params.id}/receipt`);
}));

app.get('/admin/students/:id/receipt', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const student = await db.prepare(`
    SELECT
      s.id, s.student_full_name, s.grade_level, s.parent_name, s.primary_contact_email, s.primary_contact_phone,
      COALESCE(sr.tuition_paid, s.tuition_paid) AS tuition_paid,
      COALESCE(sr.tuition_amount_paid, s.tuition_amount_paid) AS tuition_amount_paid,
      COALESCE(sr.tuition_payment_method, s.tuition_payment_method) AS tuition_payment_method,
      COALESCE(sr.tuition_paid_at, s.tuition_paid_at) AS tuition_paid_at,
      COALESCE(sr.tuition_paid_by, s.tuition_paid_by) AS tuition_paid_by,
      sr.school_year
    FROM students s
    LEFT JOIN student_registrations sr ON sr.id = s.source_registration_id
    WHERE s.id = ?
  `).get(req.params.id);

  if (!student || !student.tuition_paid || !TUITION_PAYMENT_METHODS.has(student.tuition_payment_method)) {
    req.flash('error', 'No manually-recorded payment found to generate a receipt for.');
    return res.redirect('/admin/students');
  }

  let recordedByName = null;
  if (student.tuition_paid_by) {
    const recordedByUser = await db.prepare('SELECT full_name, email FROM users WHERE id = ?').get(student.tuition_paid_by);
    recordedByName = recordedByUser ? (recordedByUser.full_name || recordedByUser.email) : null;
  }

  res.render('admin-payment-receipt', { student, recordedByName });
}));

app.post('/admin/students/:id/status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  if (!STUDENT_STATUSES.includes(requestedStatus)) {
    req.flash('error', 'Invalid student status.');
    return res.redirect('/admin/students');
  }

  const student = await db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!student) {
    return res.status(404).send('Student not found.');
  }

  await db.prepare('UPDATE students SET student_status = ? WHERE id = ?').run(requestedStatus, req.params.id);
  req.flash('success', res.locals.t('status_updated'));
  return res.redirect('/admin/students');
}));

app.post('/admin/students/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const student = await db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!student) {
    return res.status(404).send('Student not found.');
  }

  // student_registrations.student_id has no FK/cascade back to students, so it must be
  // cleared manually or it's left pointing at a row that no longer exists. The
  // registration itself is untouched — only its link to this persistent student goes away.
  await db.prepare('UPDATE student_registrations SET student_id = NULL WHERE student_id = ?').run(student.id);
  await db.prepare('DELETE FROM students WHERE id = ?').run(student.id);

  req.flash('success', res.locals.t('student_deleted'));
  return res.redirect('/admin/students');
}));

// ── Tuition Payment Import ───────────────────────────────────
// Expects the parish payment-gateway export format for Faith Formation
// registration payments (a fixed column layout with two same-named "Paid"
// columns), so fields are read positionally rather than by header name.
const TUITION_IMPORT_COLUMNS = {
  childrenTier: 0,
  sacramentalTier: 1,
  childNames: 2,
  contactPhone: 3,
  parentEmail: 4,
  additionalDonation: 5,
  totalAmount: 6,
  amountPaid: 7,
  billingName: 8,
  billingAddress1: 9,
  billingCity: 10,
  billingState: 11,
  billingZip: 12,
  billingEmail: 13,
  billingPhone: 14,
  paidStatus: 15,
  paidAmountAlt: 16,
  transactionId: 17,
  transactionResult: 18,
  transactionMessage: 19,
  createdAt: 20,
};

const parseTuitionImportAmount = (value) => {
  const num = parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(num) ? Math.round(num) : null;
};

const parseTuitionImportDate = (value) => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, monthStr, dayStr, yearStr, hourStr, minute, second, ampm] = match;
  let hour = Number(hourStr);
  if (/pm/i.test(ampm) && hour !== 12) hour += 12;
  if (/am/i.test(ampm) && hour === 12) hour = 0;
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), hour, Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toMySqlDateTime = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// Splits the free-text "names of children" field into rough name tokens,
// stripping list numbering ("1 - ") and parenthetical notes ("(4th grade)")
// so what's left over can be matched against student names.
const extractTuitionImportNameTokens = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n|,/)
    .map((s) => s.replace(/^\s*\d+\s*[-.)]\s*/, ''))
    .map((s) => s.replace(/\([^)]*\)/g, ''))
    .map((s) => s.trim())
    .filter(Boolean);
};

const normalizeNameWords = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z\s]/g, ' ')
  .split(/\s+/)
  .filter((word) => word.length > 1);

// Loose (not exact) name match: true if the two free-text names share at
// least one word of real length in common — good enough to surface a
// candidate/possible match, not to auto-apply anything on its own.
const namesLooselyMatch = (a, b) => {
  const wordsA = new Set(normalizeNameWords(a));
  if (!wordsA.size) return false;
  return normalizeNameWords(b).some((word) => wordsA.has(word));
};

// Keeps only the last 10 digits so a leading country code ("1-561-...")
// doesn't prevent an otherwise-identical phone number from matching.
const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '').slice(-10);

// Parses the uploaded CSV and, for each payment row, looks up that year's
// registrations by parent/billing email (case-insensitively) to propose
// which student(s) the payment covers, then falls back to suggesting
// possible matches by student name, parent name, or phone number when email
// alone doesn't resolve it. This never writes anything — it only builds the
// review screen's data. POST /admin/tuition-import/apply does the actual
// writes, and only for whatever the admin confirms there.
const buildTuitionImportPreview = async (schoolYear, csvBuffer) => {
  const records = parseCsv(csvBuffer, { relax_column_count: true, skip_empty_lines: true, bom: true });
  const dataRows = records.slice(1); // drop the header row

  // Fetched once and matched against in memory for every row, rather than a
  // query per row — this is also what makes email matching properly
  // case-insensitive (and whitespace-insensitive) regardless of the DB
  // column's collation, since both sides are normalized the same way here.
  const yearRegistrations = await db.prepare(
    `SELECT id, student_full_name, parent_name, primary_contact_email, primary_contact_phone
     FROM student_registrations
     WHERE school_year = ? AND status <> 'cancelled'
     ORDER BY student_full_name ASC`
  ).all(schoolYear);
  const normalizedEmailOf = (r) => String(r.primary_contact_email || '').trim().toLowerCase();

  const rows = [];
  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i];
    const get = (key) => String(cols[TUITION_IMPORT_COLUMNS[key]] ?? '').trim();

    const paidStatus = get('paidStatus');
    const transactionResult = get('transactionResult');
    const isAccepted = /accepted/i.test(paidStatus) && /^ok$/i.test(transactionResult);

    const amount = parseTuitionImportAmount(get('amountPaid')) ?? parseTuitionImportAmount(get('paidAmountAlt'));
    const paidAtDate = parseTuitionImportDate(get('createdAt'));
    const transactionId = get('transactionId');

    // Re-importing the same export (e.g. a parish admin re-downloading the
    // full-history export next month) would otherwise re-process every row
    // it already applied. The transaction ID is the payment gateway's own
    // unique identifier for the payment, so a registration already carrying
    // it means this exact payment was already imported — skip re-matching
    // it entirely rather than prompting the admin to review it again.
    const alreadyImported = transactionId
      ? !!(await db.prepare('SELECT id FROM student_registrations WHERE tuition_transaction_id = ? LIMIT 1').get(transactionId))
      : false;

    const rawChildNames = get('childNames');
    const contactPhone = get('contactPhone');
    const billingName = get('billingName');
    const parentEmail = get('parentEmail');
    const billingEmail = get('billingEmail');
    const candidateEmails = [...new Set([parentEmail, billingEmail]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean))];

    let candidateRegistrations = alreadyImported ? [] : yearRegistrations.filter((r) =>
      candidateEmails.includes(normalizedEmailOf(r)));

    const nameTokens = extractTuitionImportNameTokens(rawChildNames);
    const rowPhoneDigits = normalizePhoneDigits(contactPhone);

    // Possible matches: anyone in this year's roster who isn't already an
    // email match, but whose student name, parent name, or phone number
    // lines up with something on the payment row. These are suggestions
    // only — never pre-selected — for when the parent paid with a
    // different email than what's on the registration.
    let possibleMatches = [];
    if (!alreadyImported) {
      const candidateIds = new Set(candidateRegistrations.map((r) => r.id));
      possibleMatches = yearRegistrations
        .map((r) => {
          const matchReasons = [];
          if (rowPhoneDigits.length === 10 && normalizePhoneDigits(r.primary_contact_phone) === rowPhoneDigits) matchReasons.push('phone');
          if (billingName && namesLooselyMatch(billingName, r.parent_name)) matchReasons.push('parent_name');
          if (nameTokens.some((token) => namesLooselyMatch(token, r.student_full_name))) matchReasons.push('student_name');
          return { ...r, matchReasons };
        })
        .filter((r) => !candidateIds.has(r.id) && r.matchReasons.length);
    }

    let selectedIds = candidateRegistrations.map((r) => r.id);
    let matchStatus = 'no_match';

    if (alreadyImported) {
      selectedIds = [];
      matchStatus = 'already_imported';
    } else if (candidateRegistrations.length === 1) {
      matchStatus = 'matched';
    } else if (candidateRegistrations.length > 1) {
      const nameMatched = candidateRegistrations.filter((r) =>
        nameTokens.some((token) => namesLooselyMatch(token, r.student_full_name)));
      if (nameMatched.length && nameMatched.length < candidateRegistrations.length) {
        selectedIds = nameMatched.map((r) => r.id);
        matchStatus = 'matched';
      } else {
        // Either every candidate matched a name token, or none did — either
        // way we can't tell which of this parent's kids the payment is for
        // with confidence, so default to selecting all of them but flag the
        // row for the admin to confirm rather than treating it as settled.
        matchStatus = 'review';
      }
    } else if (possibleMatches.length) {
      // No email match, but name/parent-name/phone turned up leads — worth
      // a look rather than reporting this as a dead end.
      matchStatus = 'review';
    }

    rows.push({
      rowIndex: i,
      isAccepted,
      alreadyImported,
      amount,
      paidAtIso: toMySqlDateTime(paidAtDate || new Date()),
      raw: {
        childNames: rawChildNames,
        contactPhone,
        parentEmail,
        billingEmail,
        billingName,
        totalAmount: get('totalAmount'),
        amountPaid: get('amountPaid'),
        transactionId,
        transactionResult,
        transactionMessage: get('transactionMessage'),
        createdAt: get('createdAt'),
        paidStatus,
      },
      candidateRegistrations,
      possibleMatches,
      selectedIds,
      matchStatus,
    });
  }

  return rows;
};

app.get('/admin/tuition-import', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const faithFormationSettings = await getFaithFormationSettings();
  res.render('admin-tuition-import', {
    registrationYearOptions: getRegistrationYearOptions(parseFaithFormationStartYear(faithFormationSettings.schoolYear)),
    activeSchoolYear: faithFormationSettings.schoolYear,
  });
}));

app.post('/admin/tuition-import/preview', requireAuth, requireRole('admin'), tuitionImportUpload.single('csv_file'), asyncHandler(async (req, res) => {
  const schoolYear = typeof req.body.school_year === 'string' ? req.body.school_year.trim() : '';
  if (!/^\d{4}-\d{4}$/.test(schoolYear)) {
    req.flash('error', 'Please choose a valid school year.');
    return res.redirect('/admin/tuition-import');
  }
  if (!req.file) {
    req.flash('error', 'Please choose a CSV file to upload.');
    return res.redirect('/admin/tuition-import');
  }

  let rows;
  try {
    rows = await buildTuitionImportPreview(schoolYear, req.file.buffer);
  } catch (error) {
    console.error('Failed to parse tuition import CSV', error);
    req.flash('error', 'Could not read that file as CSV. Please check the export and try again.');
    return res.redirect('/admin/tuition-import');
  }

  req.session.tuitionImportPreview = { schoolYear, rows, createdAt: Date.now() };

  res.render('admin-tuition-import-review', { schoolYear, rows });
}));

app.post('/admin/tuition-import/apply', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const preview = req.session.tuitionImportPreview;
  if (!preview) {
    req.flash('error', 'That import has expired. Please upload the file again.');
    return res.redirect('/admin/tuition-import');
  }

  const skippedRows = new Set(
    (Array.isArray(req.body.skip) ? req.body.skip : (req.body.skip ? [req.body.skip] : [])).map(Number)
  );

  let registrationsUpdated = 0;
  let duplicatesSkipped = 0;
  for (const row of preview.rows) {
    if (!row.isAccepted || row.alreadyImported || skippedRows.has(row.rowIndex)) continue;

    // Re-check at apply time (not just what the preview saw) in case another
    // import already claimed this transaction ID in the meantime.
    if (row.raw.transactionId) {
      const dupe = await db.prepare('SELECT id FROM student_registrations WHERE tuition_transaction_id = ? LIMIT 1').get(row.raw.transactionId);
      if (dupe) {
        duplicatesSkipped++;
        continue;
      }
    }

    const allowedIds = new Set([...row.candidateRegistrations, ...(row.possibleMatches || [])].map((r) => r.id));
    const submittedIds = req.body[`selected_${row.rowIndex}`];
    const chosenIds = (Array.isArray(submittedIds) ? submittedIds : (submittedIds ? [submittedIds] : []))
      .map(Number)
      .filter((id) => allowedIds.has(id));

    for (const registrationId of chosenIds) {
      const reg = await db.prepare('SELECT id, student_id FROM student_registrations WHERE id = ?').get(registrationId);
      if (!reg) continue;

      await db.prepare(
        `UPDATE student_registrations SET
           tuition_paid = 1, tuition_paid_at = ?, tuition_paid_by = ?,
           tuition_amount_paid = ?, tuition_transaction_id = ?, tuition_payment_method = 'imported'
         WHERE id = ?`
      ).run(row.paidAtIso, req.user.id, row.amount, row.raw.transactionId || null, registrationId);

      if (reg.student_id) {
        await db.prepare(
          `UPDATE students SET
             tuition_paid = 1, tuition_paid_at = ?, tuition_paid_by = ?,
             tuition_amount_paid = ?, tuition_transaction_id = ?, tuition_payment_method = 'imported'
           WHERE id = ?`
        ).run(row.paidAtIso, req.user.id, row.amount, row.raw.transactionId || null, reg.student_id);
      }

      registrationsUpdated++;
    }
  }

  delete req.session.tuitionImportPreview;

  const summaryParts = [`Tuition payments applied to ${registrationsUpdated} registration${registrationsUpdated === 1 ? '' : 's'}.`];
  if (duplicatesSkipped) {
    summaryParts.push(`Skipped ${duplicatesSkipped} row${duplicatesSkipped === 1 ? '' : 's'} already imported.`);
  }
  req.flash('success', summaryParts.join(' '));
  return res.redirect('/admin/students');
}));

app.get('/admin/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const validRoles = ['user', 'catechist', 'family_faith_leader', 'admin'];
  const roleFilter = validRoles.includes(req.query.role) ? req.query.role : '';
  const users = await db.prepare(`
    SELECT id, email, role, provider, full_name, phone, is_active, account_status, email_verified_at, created_at, last_login_at
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

  const priorYearRow = await db.prepare(
    'SELECT faith_formation_open FROM registration_year_settings WHERE school_year = ?'
  ).get(schoolYear);
  const wasOpen = !!priorYearRow?.faith_formation_open;

  await db.prepare(
    `INSERT INTO registration_year_settings (school_year, faith_formation_open, sponsor_form_open)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       faith_formation_open = VALUES(faith_formation_open),
       sponsor_form_open = VALUES(sponsor_form_open)`
  ).run(schoolYear, faithFormationRegistrationOpen, sponsorFormRegistrationOpen);

  // Closing a year's Faith Formation registration rolls its currently-Enrolled students
  // forward: a class-history entry is recorded and their registration for that year is
  // archived, out of active views/rosters, while the student itself stays Enrolled.
  if (wasOpen && !faithFormationRegistrationOpen) {
    await rolloverEnrolledStudentsForSchoolYear(schoolYear);
  }

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

app.post('/admin/users/:id/profile', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

  if (!fullName) {
    req.flash('error', 'Full name is required.');
    return res.redirect('/admin/users');
  }
  if (phone && !phoneRegex.test(phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect('/admin/users');
  }

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  await db.prepare(
    'UPDATE users SET full_name = ?, first_name = ?, last_name = ?, phone = ? WHERE id = ?'
  ).run(fullName, firstName, lastName, phone || null, req.params.id);

  req.flash('success', 'User profile updated.');
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

// ── Resources ─────────────────────────────────────────────────
// A shared document library every logged-in user can see (scoped to whatever an admin
// has assigned them), separate from the per-registration certificate uploads above.

app.get('/resources', requireAuth, asyncHandler(async (req, res) => {
  const resources = await getVisibleResourcesForUser(req.user);
  res.render('resources', { resources });
}));

app.get('/resources/:id/download', requireAuth, asyncHandler(async (req, res) => {
  const resourceId = Number.parseInt(req.params.id, 10);
  const resource = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  if (!resource) {
    req.flash('error', res.locals.t('resource_not_found'));
    return res.redirect('/resources');
  }

  if (req.user.role !== 'admin') {
    const assignments = await db.prepare('SELECT * FROM resource_assignments WHERE resource_id = ?').all(resourceId);
    const catechistClassIds = new Set(await getCatechistClassIds(req.user.id));
    const parentClassIds = new Set(await getParentClassIds(req.user.id));
    if (!userMatchesAssignmentRules(assignments, req.user, catechistClassIds, parentClassIds)) {
      req.flash('error', res.locals.t('resource_not_found'));
      return res.redirect('/resources');
    }
  }

  return res.download(path.join(resourceUploadDir, resource.stored_filename), resource.original_filename);
}));

app.get('/admin/resources', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const resources = await db.prepare('SELECT * FROM resources ORDER BY created_at DESC').all();
  const assignments = await db.prepare('SELECT * FROM resource_assignments').all();
  const ccdClasses = await getCcdClasses();
  const ccdClassById = new Map(ccdClasses.map((c) => [c.id, c]));
  const assignableUsers = await db.prepare(`
    SELECT id, full_name, email, role FROM users
    WHERE COALESCE(account_status, 'active') <> 'deleted'
    ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC
  `).all();
  const userById = new Map(assignableUsers.map((u) => [u.id, u]));
  const { roleLabels, describeAssignment } = buildAssignmentDescriber(res.locals.t, ccdClassById, userById);

  const assignmentsByResource = new Map();
  assignments.forEach((a) => {
    if (!assignmentsByResource.has(a.resource_id)) assignmentsByResource.set(a.resource_id, []);
    assignmentsByResource.get(a.resource_id).push(a);
  });

  res.render('admin-resources', {
    resources: resources.map((r) => ({
      ...r,
      assignmentLabels: (assignmentsByResource.get(r.id) || []).map(describeAssignment),
    })),
    ccdClasses,
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
    assignableUsers,
    assignableRoles: ASSIGNABLE_AUDIENCE_ROLES,
    roleLabels,
    preselectTargetUserId: Number.parseInt(req.query.target_user_id, 10) || null,
  });
}));

app.post('/admin/resources', requireAuth, requireRole('admin'), resourceUpload.single('file'), asyncHandler(async (req, res) => {
  const cleanupUpload = async () => {
    if (req.file) { try { await fs.promises.unlink(req.file.path); } catch { /* already gone */ } }
  };

  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 255) : '';
  if (!title || !req.file) {
    await cleanupUpload();
    req.flash('error', res.locals.t('resource_title_and_file_required'));
    return res.redirect('/admin/resources');
  }

  const assignmentFields = parseAssignmentFieldsFromBody(req.body);
  if (!hasAnyAssignment(assignmentFields)) {
    await cleanupUpload();
    req.flash('error', res.locals.t('resource_assignment_required'));
    return res.redirect('/admin/resources');
  }

  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 2000) : '';

  const result = await db.prepare(`
    INSERT INTO resources (title, description, stored_filename, original_filename, uploaded_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description || null, req.file.filename, req.file.originalname, req.user.id);
  const resourceId = result.lastInsertRowid;

  await insertAssignmentRows('resource_assignments', 'resource_id', resourceId, assignmentFields);

  // Same audience as the resource itself — anyone who can see the resource gets a
  // dismissible banner pointing at it. The checkbox defaults to checked in the form, so
  // an unchecked (and therefore entirely absent from the submitted body) checkbox is the
  // only way to opt out, e.g. for a quiet update to an existing document set.
  if (req.body.notify === 'on') {
    const notifResult = await db.prepare(`
      INSERT INTO notifications (type, title, message, resource_id, created_by)
      VALUES ('resource', ?, ?, ?, ?)
    `).run(res.locals.t('new_resource_notification_title'), title, resourceId, req.user.id);
    await insertAssignmentRows('notification_assignments', 'notification_id', notifResult.lastInsertRowid, assignmentFields);
  }

  req.flash('success', res.locals.t('resource_added'));
  return res.redirect('/admin/resources');
}));

app.post('/admin/resources/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const resourceId = Number.parseInt(req.params.id, 10);
  const resource = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  if (!resource) {
    req.flash('error', res.locals.t('resource_not_found'));
    return res.redirect('/admin/resources');
  }

  await db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
  try { await fs.promises.unlink(path.join(resourceUploadDir, resource.stored_filename)); } catch { /* already gone */ }

  req.flash('success', res.locals.t('resource_removed'));
  return res.redirect('/admin/resources');
}));

// Sends (or re-sends) a notification for a resource that already exists — covers
// resources uploaded before this button existed, and re-reminding an audience later.
// Always creates a fresh notification row, so it requires a fresh acknowledgement even
// from someone who dismissed an earlier one for the same resource.
app.post('/admin/resources/:id/notify', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const resourceId = Number.parseInt(req.params.id, 10);
  const resource = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  if (!resource) {
    req.flash('error', res.locals.t('resource_not_found'));
    return res.redirect('/admin/resources');
  }

  const assignmentRows = await db.prepare('SELECT * FROM resource_assignments WHERE resource_id = ?').all(resourceId);
  const assignmentFields = assignmentRowsToFields(assignmentRows);
  if (!hasAnyAssignment(assignmentFields)) {
    req.flash('error', res.locals.t('resource_assignment_required'));
    return res.redirect('/admin/resources');
  }

  const notifResult = await db.prepare(`
    INSERT INTO notifications (type, title, message, resource_id, created_by)
    VALUES ('resource', ?, ?, ?, ?)
  `).run(res.locals.t('new_resource_notification_title'), resource.title, resourceId, req.user.id);
  await insertAssignmentRows('notification_assignments', 'notification_id', notifResult.lastInsertRowid, assignmentFields);

  req.flash('success', res.locals.t('notification_added'));
  return res.redirect('/admin/resources');
}));

// ── Notifications ─────────────────────────────────────────────
// Dismissible banners shown on every page (see the per-request middleware and
// _topbar.ejs) until the viewing user acknowledges them. Created either directly by an
// admin (a broadcast) or automatically alongside a resource upload (see above).
app.post('/notifications/:id/acknowledge', requireAuth, asyncHandler(async (req, res) => {
  const notificationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(notificationId)) {
    return res.status(400).json({ ok: false });
  }
  await db.prepare(
    'INSERT IGNORE INTO notification_acknowledgements (notification_id, user_id) VALUES (?, ?)'
  ).run(notificationId, req.user.id);
  return res.json({ ok: true });
}));

app.get('/admin/notifications', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const notifications = await db.prepare(
    `SELECT n.*, (SELECT COUNT(*) FROM notification_acknowledgements na WHERE na.notification_id = n.id) AS acknowledgedCount
     FROM notifications n ORDER BY n.created_at DESC`
  ).all();
  const assignments = await db.prepare('SELECT * FROM notification_assignments').all();
  const ccdClasses = await getCcdClasses();
  const ccdClassById = new Map(ccdClasses.map((c) => [c.id, c]));
  const assignableUsers = await db.prepare(`
    SELECT id, full_name, email, role FROM users
    WHERE COALESCE(account_status, 'active') <> 'deleted'
    ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC
  `).all();
  const userById = new Map(assignableUsers.map((u) => [u.id, u]));
  const { roleLabels, describeAssignment } = buildAssignmentDescriber(res.locals.t, ccdClassById, userById);

  const assignmentsByNotification = new Map();
  assignments.forEach((a) => {
    if (!assignmentsByNotification.has(a.notification_id)) assignmentsByNotification.set(a.notification_id, []);
    assignmentsByNotification.get(a.notification_id).push(a);
  });

  res.render('admin-notifications', {
    notifications: notifications.map((n) => ({
      ...n,
      assignmentLabels: (assignmentsByNotification.get(n.id) || []).map(describeAssignment),
    })),
    ccdClasses,
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
    assignableUsers,
    assignableRoles: ASSIGNABLE_AUDIENCE_ROLES,
    roleLabels,
    preselectTargetUserId: Number.parseInt(req.query.target_user_id, 10) || null,
  });
}));

app.post('/admin/notifications', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 255) : '';
  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
  if (!title) {
    req.flash('error', res.locals.t('notification_title_required'));
    return res.redirect('/admin/notifications');
  }

  const assignmentFields = parseAssignmentFieldsFromBody(req.body);
  if (!hasAnyAssignment(assignmentFields)) {
    req.flash('error', res.locals.t('resource_assignment_required'));
    return res.redirect('/admin/notifications');
  }

  const result = await db.prepare(`
    INSERT INTO notifications (type, title, message, created_by) VALUES ('broadcast', ?, ?, ?)
  `).run(title, message || null, req.user.id);
  await insertAssignmentRows('notification_assignments', 'notification_id', result.lastInsertRowid, assignmentFields);

  req.flash('success', res.locals.t('notification_added'));
  return res.redirect('/admin/notifications');
}));

app.post('/admin/notifications/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  req.flash('success', res.locals.t('notification_removed'));
  return res.redirect('/admin/notifications');
}));

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

  // The grade dropdown already includes "ocia" (from CCD_GRADE_MEANINGS); the Adult
  // Events page's own small form submits "family_faith" the same way. Either one flags
  // the row as an adult class rostered from a program-specific table instead of student
  // registrations — see getClassRoster.
  const ADULT_PROGRAM_GRADE_LEVELS = new Set(['ocia', 'family_faith']);
  const classKind = ADULT_PROGRAM_GRADE_LEVELS.has(gradeLevel) ? 'adult' : 'children';
  const sourceProgramType = classKind === 'adult' ? gradeLevel : null;
  // Only Family Faith Formation pairs with a specific children's class — meaningless (and
  // ignored) for OCIA or a regular children's class.
  const rawLinkedClassId = Number.parseInt(req.body.linked_class_id, 10);
  const linkedClassId = sourceProgramType === 'family_faith' && Number.isInteger(rawLinkedClassId) ? rawLinkedClassId : null;

  await db.prepare(
    `INSERT INTO ccd_classes (grade_level, class_time, classroom, class_kind, source_program_type, linked_class_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(gradeLevel, classTime, classroom, classKind, sourceProgramType, linkedClassId);
  req.flash('success', 'CCD class saved. A grade can have multiple time-slot sections — add another with the same grade to offer parents a choice.');
  return res.redirect(classKind === 'adult' ? '/admin/adult-classes' : '/admin/users');
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

// Schedule edit actions default to redirecting back to the class detail page, but the
// per-class calendar view (/calendar/class/:id) posts to these same routes and wants to
// stay put instead — it passes its own URL as return_to. Only honored when it actually
// points back at that class's calendar, so this can't be used as an open redirect.
const resolveScheduleRedirect = (returnTo, classId, fallback) => {
  const safePattern = new RegExp(`^/calendar/class/${classId}(?:\\?[^\\s]*)?$`);
  return typeof returnTo === 'string' && safePattern.test(returnTo) ? returnTo : fallback;
};

const getOwnedCcdClass = async (req, classId) => {
  const ccdClasses = await getCcdClasses();
  const ccdClass = ccdClasses.find((c) => c.id === classId);
  if (!ccdClass) return null;
  if (req.user.role !== 'admin' && !isClassCatechist(ccdClass, req.user.id)) return null;
  return ccdClass;
};

app.get('/admin/catechists', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const catechists = await db.prepare(`
    SELECT id, full_name, email, phone FROM users
    WHERE role = 'catechist' AND COALESCE(account_status, 'active') <> 'deleted'
    ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC
  `).all();

  const ccdClasses = await getCcdClasses();
  const classesByCatechist = new Map();
  ccdClasses.forEach((c) => {
    c.catechists.forEach((catechist) => {
      if (!classesByCatechist.has(catechist.id)) classesByCatechist.set(catechist.id, []);
      classesByCatechist.get(catechist.id).push(c);
    });
  });

  res.render('admin-catechists', {
    catechists: catechists.map((c) => ({
      ...c,
      classLabels: (classesByCatechist.get(c.id) || []).map(getCcdClassShortLabel),
    })),
    templates: listTemplatesWithFields(),
  });
}));

// Reads the submitted `field_<id>` inputs for a template's placeholders back into a
// {token: value} map, using the same extraction the template's form fields were built
// from — see email-templates.js for why fields are keyed by a hash of the token, not
// their position in the file.
const readTemplateFieldValues = (tpl, body) => {
  const valuesByToken = {};
  tpl.fields.forEach((field) => {
    valuesByToken[field.token] = body[`field_${field.id}`];
  });
  return valuesByToken;
};

// Renders a chosen template with the submitted placeholder values as a standalone HTML
// page — the target of the composer's "Preview" button (formtarget="_blank"), so a
// sender can check the filled-in email before it goes out.
app.post('/admin/catechists/email-preview', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const templateId = typeof req.body.template === 'string' ? req.body.template : '';
  const tpl = listTemplatesWithFields().find((t) => t.id === templateId);
  if (!tpl) {
    return res.status(400).send('Unknown email template.');
  }

  const html = renderTemplate(tpl.id, readTemplateFieldValues(tpl, req.body));
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
}));

// Direct one-off email to a single catechist — reuses the same personal-correspondence
// mailer as class messages (buildClassMessageEmailContent's default subject/signature
// already reads fine outside a class context, so no separate template is needed).
app.post('/admin/catechists/:id/message', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const catechist = await db.prepare(
    `SELECT id, full_name, email FROM users WHERE id = ? AND role = 'catechist'`
  ).get(req.params.id);
  if (!catechist || !catechist.email) {
    req.flash('error', res.locals.t('catechist_not_found'));
    return res.redirect('/admin/catechists');
  }

  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  if (!message) {
    req.flash('error', res.locals.t('catechist_message_required'));
    return res.redirect('/admin/catechists');
  }

  const result = await sendClassMessageEmail({
    to: catechist.email,
    subject,
    message,
    senderName: req.user.full_name || req.user.email,
    replyTo: req.user.email || undefined,
  });

  if (result.delivered) {
    req.flash('success', res.locals.t('catechist_message_sent').replace('%s', catechist.full_name || catechist.email));
  } else {
    req.flash('error', res.locals.t('catechist_message_failed'));
  }
  return res.redirect('/admin/catechists');
}));

const STAFF_BROADCAST_ROLES = new Set(['catechist', 'admin', 'family_faith_leader']);

// One email addressed to the admin with every selected staff member Bcc'd, so recipients
// can't see each other's addresses — same pattern the per-class "Bcc all" message option
// already uses (see sendClassMessageEmail's bcc param).
app.post('/admin/catechists/broadcast', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const roles = [].concat(req.body.roles || []).filter((role) => STAFF_BROADCAST_ROLES.has(role));
  if (!roles.length) {
    req.flash('error', res.locals.t('staff_broadcast_roles_required'));
    return res.redirect('/admin/catechists');
  }

  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  const templateId = typeof req.body.template === 'string' ? req.body.template.trim() : '';
  const tpl = templateId ? listTemplatesWithFields().find((t) => t.id === templateId) : null;
  if (templateId && !tpl) {
    return res.status(400).send('Unknown email template.');
  }

  // A template supplies its own body from placeholder fields; without one, the free-text
  // Message box is required, same as before templates existed.
  if (!tpl && !message) {
    req.flash('error', res.locals.t('catechist_message_required'));
    return res.redirect('/admin/catechists');
  }

  const recipients = await db.prepare(
    `SELECT DISTINCT email FROM users
     WHERE role IN (${roles.map(() => '?').join(',')}) AND COALESCE(account_status, 'active') <> 'deleted' AND email IS NOT NULL AND email <> ''`
  ).all(...roles);
  const bccList = recipients.map((r) => r.email);
  if (!bccList.length) {
    req.flash('error', res.locals.t('staff_broadcast_no_recipients'));
    return res.redirect('/admin/catechists');
  }

  const templateHtml = tpl ? renderTemplate(tpl.id, readTemplateFieldValues(tpl, req.body)) : null;

  const result = await sendClassMessageEmail({
    to: req.user.email,
    bcc: bccList.join(', '),
    subject: subject || (tpl ? tpl.label : undefined),
    message,
    html: templateHtml || undefined,
    senderName: req.user.full_name || req.user.email,
    replyTo: req.user.email || undefined,
  });

  if (!result.delivered) {
    req.flash('error', res.locals.t('catechist_message_failed'));
    return res.redirect('/admin/catechists');
  }

  // sendMail() not throwing only means the SMTP server accepted the request — an
  // individual Bcc address can still bounce at the RCPT TO stage and come back in
  // result.rejected, so check that before telling the sender it actually went out.
  const rejectedSet = new Set((result.rejected || []).map((addr) => String(addr).toLowerCase()));
  const rejectedBcc = bccList.filter((addr) => rejectedSet.has(addr.toLowerCase()));

  if (rejectedBcc.length) {
    console.warn('[admin] Staff broadcast partially rejected by SMTP server', { rejected: rejectedBcc });
    req.flash('error', res.locals.t('staff_broadcast_partial')
      .replace('%s', bccList.length - rejectedBcc.length)
      .replace('%s', bccList.length)
      .replace('%s', rejectedBcc.join(', ')));
  } else {
    req.flash('success', res.locals.t('staff_broadcast_sent').replace('%s', bccList.length));
  }
  return res.redirect('/admin/catechists');
}));

app.get('/admin/classes', requireAuth, requireRole('admin', 'catechist'), asyncHandler(async (req, res) => {
  const allCcdClasses = (await getCcdClasses()).filter((c) => c.classKind !== 'adult');
  const ccdClasses = req.user.role === 'catechist'
    ? allCcdClasses.filter((c) => isClassCatechist(c, req.user.id))
    : allCcdClasses;
  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();
  const enrolledRegistrationIds = await getEnrolledRegistrationIds();

  const classes = await Promise.all(ccdClasses.map(async (ccdClass) => {
    const roster = getClassRoster(ccdClass, activeStudentRegs, enrolledRegistrationIds);
    return {
      ...ccdClass,
      studentCount: roster.length,
      pendingCount: roster.filter(isPendingAcceptance).length,
      nextSessionDate: await getNextSessionDateForClass(ccdClass.id, ccdClass.class_time),
    };
  }));

  res.render('admin-classes', { classes, ccdGradeMeanings: CCD_GRADE_MEANINGS });
}));

// OCIA and Family Faith Formation live here instead of the children's Classes list —
// they're rostered from their own program tables (see getClassRoster) and have no grade
// level a parent picks during registration, so mixing them into the grade-grid page would
// be confusing. Open to catechists/family_faith_leaders too (not just admin) so whoever's
// assigned as that class's "teacher" can reach their own roster/attendance/schedule.
app.get('/admin/adult-classes', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const allCcdClasses = await getCcdClasses();
  const allAdultClasses = allCcdClasses.filter((c) => c.classKind === 'adult');
  const ccdClasses = req.user.role === 'admin'
    ? allAdultClasses
    : allAdultClasses.filter((c) => isClassCatechist(c, req.user.id));
  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();
  const enrolledRegistrationIds = await getEnrolledRegistrationIds();
  const activeAdultRegs = await getActiveAdultRegistrations();
  const activeFamilyFaithRegs = await getActiveFamilyFaithRegistrations();

  const classes = await Promise.all(ccdClasses.map(async (ccdClass) => {
    const roster = getClassRoster(ccdClass, activeStudentRegs, enrolledRegistrationIds, activeAdultRegs, activeFamilyFaithRegs, allCcdClasses);
    return {
      ...ccdClass,
      studentCount: roster.length,
      pendingCount: roster.filter(isPendingAcceptance).length,
      nextSessionDate: await getNextSessionDateForClass(ccdClass.id, ccdClass.class_time),
    };
  }));

  const childrenClasses = allCcdClasses.filter((c) => c.classKind !== 'adult');
  const childrenClassById = new Map(childrenClasses.map((c) => [c.id, c]));

  res.render('admin-classes-adult', {
    classes: classes.map((c) => ({
      ...c,
      linkedClassLabel: c.linkedClassId && childrenClassById.has(c.linkedClassId)
        ? `${getCcdClassShortLabel(childrenClassById.get(c.linkedClassId))} — ${childrenClassById.get(c.linkedClassId).class_time || '—'}`
        : null,
    })),
    childrenClasses,
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
    adultProgramLabels: ADULT_PROGRAM_LABELS,
  });
}));

app.get('/admin/classes/:id', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();
  const enrolledRegistrationIds = await getEnrolledRegistrationIds();
  const activeAdultRegs = await getActiveAdultRegistrations();
  const activeFamilyFaithRegs = await getActiveFamilyFaithRegistrations();
  const allCcdClasses = await getCcdClasses();
  const roster = getClassRoster(ccdClass, activeStudentRegs, enrolledRegistrationIds, activeAdultRegs, activeFamilyFaithRegs, allCcdClasses)
    .sort((a, b) => (a.student_full_name || '').localeCompare(b.student_full_name || ''));

  const storedSchedule = await getClassSessionDates(classId);
  const hasStoredSchedule = storedSchedule.length > 0;
  const upcomingDates = hasStoredSchedule ? storedSchedule.map((s) => s.date) : getUpcomingSessionDates(ccdClass.class_time);
  const descriptionByDate = new Map(storedSchedule.map((s) => [formatSessionDateValue(s.date), s.description]));
  const eventTypeByDate = new Map(storedSchedule.map((s) => [formatSessionDateValue(s.date), s.eventType]));
  const today = formatSessionDateValue(new Date());
  const nextSessionDate = upcomingDates.find((d) => formatSessionDateValue(d) >= today) || upcomingDates[0];
  const nextSessionValue = nextSessionDate ? formatSessionDateValue(nextSessionDate) : null;
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
  const faithFormationSettings = await getFaithFormationSettings();

  const assignedCatechistIds = new Set((ccdClass.catechists || []).map((c) => c.id));
  // A family_faith_leader can be a legitimate "teacher" for any adult faith formation
  // class, not just Family Faith Formation itself (e.g. leading OCIA or Baptism Prep) —
  // widen the assignable pool for every adult class instead of teaching
  // getAssignableTeachers about a role it otherwise has no reason to know.
  const assignableCatechistPool = ccdClass.classKind === 'adult'
    ? [...(await getAssignableTeachers()), ...(await getFamilyFaithLeaders())]
    : await getAssignableTeachers();
  const assignableCatechists = req.user.role === 'admin'
    ? assignableCatechistPool.filter((c) => !assignedCatechistIds.has(c.id))
    : [];

  // Whole-class attendance history — powers the per-student absence badge/history dots
  // and the year-to-date rate below, all derived from real ccd_class_attendance rows
  // rather than invented compliance fields.
  const allAttendanceRows = await db.prepare(
    'SELECT student_registration_id, session_date, status FROM ccd_class_attendance WHERE ccd_class_id = ?'
  ).all(classId);
  const attendanceByStudentDate = new Map();
  const countsByDate = new Map();
  allAttendanceRows.forEach((row) => {
    const dateValue = formatSessionDateValue(new Date(row.session_date));
    attendanceByStudentDate.set(`${row.student_registration_id}|${dateValue}`, row.status);
    if (!countsByDate.has(dateValue)) countsByDate.set(dateValue, { present: 0, absent: 0 });
    if (row.status === 'present') countsByDate.get(dateValue).present += 1;
    if (row.status === 'absent') countsByDate.get(dateValue).absent += 1;
  });

  const pastSessionDates = hasStoredSchedule
    ? upcomingDates.map((d) => formatSessionDateValue(d)).filter((v) => v <= today)
    : [];
  const historyDates = pastSessionDates.slice(-7);

  const rosterWithHistory = roster.map((r) => {
    const presentTotal = pastSessionDates.filter((d) => attendanceByStudentDate.get(`${r.id}|${d}`) === 'present').length;
    const absentTotal = pastSessionDates.filter((d) => attendanceByStudentDate.get(`${r.id}|${d}`) === 'absent').length;
    const historyPresentCount = historyDates.filter((d) => attendanceByStudentDate.get(`${r.id}|${d}`) === 'present').length;
    return {
      ...r,
      age: calculateAge(r.student_dob),
      absenceCount: absentTotal,
      baptismCertPending: SACRAMENTAL_GRADE_LEVELS.has(ccdClass.grade_level) && !r.baptism_certificate_path,
      isAltarServer: !!r.is_altar_server,
      attendanceRatePercent: pastSessionDates.length ? Math.round((presentTotal / pastSessionDates.length) * 100) : null,
      history: historyDates.map((d) => ({ date: d, status: attendanceByStudentDate.get(`${r.id}|${d}`) || null })),
      historyPresentCount,
    };
  });

  const classPresentTotal = allAttendanceRows.filter((row) => row.status === 'present').length;
  const classPossibleTotal = pastSessionDates.length * roster.length;
  const classAttendanceRatePercent = classPossibleTotal > 0 ? Math.round((classPresentTotal / classPossibleTotal) * 100) : null;
  const lowAttendanceStudents = pastSessionDates.length >= 3
    ? rosterWithHistory.filter((r) => r.attendanceRatePercent !== null && r.attendanceRatePercent < 75)
    : [];

  const upcomingCelebrations = rosterWithHistory
    .flatMap((r) => {
      const birthday = getUpcomingAnniversary(r.student_dob);
      const baptismAnniversary = getUpcomingAnniversary(r.baptism_date);
      const entries = [];
      if (birthday) entries.push({ studentName: r.student_full_name, type: 'birthday', ...birthday });
      if (baptismAnniversary) entries.push({ studentName: r.student_full_name, type: 'baptism_anniversary', ...baptismAnniversary });
      return entries;
    })
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const linkedClass = ccdClass.linkedClassId ? allCcdClasses.find((c) => c.id === ccdClass.linkedClassId) : null;

  res.render('admin-class-detail', {
    ccdClass,
    roster: rosterWithHistory,
    isPendingAcceptance,
    ccdGradeMeanings: CCD_GRADE_MEANINGS,
    adultProgramLabels: ADULT_PROGRAM_LABELS,
    linkedClassLabel: linkedClass ? `${getCcdClassShortLabel(linkedClass)} — ${linkedClass.class_time || '—'}` : null,
    upcomingDates: upcomingDates.map((d) => {
      const value = formatSessionDateValue(d);
      const counts = countsByDate.get(value);
      return {
        value,
        isNext: value === nextSessionValue,
        description: descriptionByDate.get(value) || '',
        eventType: eventTypeByDate.get(value) || 'class_day',
        presentCount: counts ? counts.present : null,
      };
    }),
    hasStoredSchedule,
    defaultSchoolYear: faithFormationSettings.schoolYear,
    selectedDate,
    selectedDescription: descriptionByDate.get(selectedDate) || '',
    attendanceByStudent,
    presentCount,
    absentCount,
    unmarkedCount: roster.length - presentCount - absentCount,
    assignableCatechists,
    classAttendanceRatePercent,
    lowAttendanceStudents,
    upcomingCelebrations,
  });
}));

app.post('/admin/classes/:id/catechists/add', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const catechistId = Number.parseInt(req.body.catechist_user_id, 10);
  if (!Number.isInteger(classId) || !Number.isInteger(catechistId)) {
    req.flash('error', 'Invalid request.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  const validTeacher = await db.prepare(
    `SELECT id FROM users WHERE id = ? AND role IN ('admin', 'catechist', 'family_faith_leader') AND COALESCE(account_status, 'active') <> 'deleted'`
  ).get(catechistId);
  if (!validTeacher) {
    req.flash('error', 'That user is not an active admin, catechist, or family faith leader.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  await db.prepare(
    'INSERT IGNORE INTO ccd_class_catechists (ccd_class_id, catechist_user_id) VALUES (?, ?)'
  ).run(classId, catechistId);
  req.flash('success', 'Teacher assigned to class.');
  return res.redirect(`/admin/classes/${classId}`);
}));

app.post('/admin/classes/:id/catechists/remove', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const catechistId = Number.parseInt(req.body.catechist_user_id, 10);
  if (!Number.isInteger(classId) || !Number.isInteger(catechistId)) {
    req.flash('error', 'Invalid request.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  await db.prepare(
    'DELETE FROM ccd_class_catechists WHERE ccd_class_id = ? AND catechist_user_id = ?'
  ).run(classId, catechistId);
  req.flash('success', 'Teacher removed from class.');
  return res.redirect(`/admin/classes/${classId}`);
}));

// Catches up a linked Family Faith Formation class with families whose child was admitted
// before this pairing existed (or before FFF auto-enrollment existed at all) — reuses the
// exact same autoEnrollFamilyFaithFormation used on every new registration, so it's safe
// to click more than once (already-enrolled families are a no-op).
app.post('/admin/classes/:id/backfill-family-faith', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass || ccdClass.sourceProgramType !== 'family_faith' || !ccdClass.linkedClassId) {
    req.flash('error', 'This class has no linked children\'s class to back-fill from.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  const allCcdClasses = await getCcdClasses();
  const linkedClass = allCcdClasses.find((c) => c.id === ccdClass.linkedClassId);
  if (!linkedClass) {
    req.flash('error', 'Linked class no longer exists.');
    return res.redirect(`/admin/classes/${classId}`);
  }

  const activeStudentRegs = await db.prepare('SELECT * FROM student_registrations WHERE archived_at IS NULL').all();
  const enrolledRegistrationIds = await getEnrolledRegistrationIds();
  const admittedRegs = getClassRoster(linkedClass, activeStudentRegs, enrolledRegistrationIds)
    .filter((reg) => reg.status === 'admitted');

  let backfilledCount = 0;
  for (const reg of admittedRegs) {
    const sacramentalYear = reg.sacramental_year
      || (linkedClass.grade_level === '1' ? 'first_year_communion' : linkedClass.grade_level === '8' ? 'first_year_confirmation' : null);
    if (!sacramentalYear) continue;
    // student_full_name is the only stored form of the child's name (first/middle/last
    // are only ever submitted separately, never persisted separately) — take the last
    // word as the surname and everything before it as the given name, same split the
    // original wizard submission would have produced for a first+last (no middle) name.
    const nameParts = (reg.student_full_name || '').trim().split(/\s+/);
    const childLastName = nameParts.length > 1 ? nameParts.pop() : (nameParts[0] || '');
    const childFirstName = nameParts.join(' ');

    await autoEnrollFamilyFaithFormation({
      userId: reg.user_id,
      schoolYear: reg.school_year,
      sacramentalYear,
      childFirstName,
      childLastName,
      childDob: reg.student_dob,
      parentFirstName: reg.primary_contact_first_name,
      parentLastName: reg.primary_contact_last_name,
      parentEmail: reg.primary_contact_email,
      parentPhone: reg.primary_contact_phone,
    });
    backfilledCount += 1;
  }

  req.flash('success', `Checked ${backfilledCount} admitted famil${backfilledCount === 1 ? 'y' : 'ies'} — already-enrolled ones were left untouched.`);
  return res.redirect(`/admin/classes/${classId}`);
}));

app.post('/admin/classes/:id/attendance', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
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

app.post('/admin/classes/:id/schedule/generate', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const weekdayIndex = parseClassWeekday(ccdClass.class_time);
  if (weekdayIndex === null) {
    req.flash('error', res.locals.t('generate_schedule_needs_weekday'));
    return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}`));
  }

  const requestedSchoolYear = typeof req.body.school_year === 'string' ? req.body.school_year.trim() : '';
  const startYear = parseFaithFormationStartYear(requestedSchoolYear || getDefaultFaithFormationYear());
  const rangeStart = new Date(startYear, 8, 1);
  const rangeEnd = new Date(startYear + 1, 4, 31);
  const dates = generateWeeklyDatesInRange(weekdayIndex, rangeStart, rangeEnd);

  if (dates.length) {
    const placeholders = dates.map(() => '(?, ?)').join(', ');
    const params = dates.flatMap((date) => [classId, formatSessionDateValue(date)]);
    await db.prepare(
      `INSERT IGNORE INTO ccd_class_session_dates (ccd_class_id, session_date) VALUES ${placeholders}`
    ).run(...params);
  }

  req.flash('success', `Added ${dates.length} class day(s).`);
  return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}`));
}));

app.post('/admin/classes/:id/schedule/add', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const sessionDate = typeof req.body.session_date === 'string' ? req.body.session_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    req.flash('error', res.locals.t('invalid_class_day'));
    return res.redirect(`/admin/classes/${classId}`);
  }
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 255) : '';
  const eventType = isValidClassSessionEventType(req.body.event_type) ? req.body.event_type : 'class_day';

  await db.prepare(
    'INSERT IGNORE INTO ccd_class_session_dates (ccd_class_id, session_date, description, event_type) VALUES (?, ?, ?, ?)'
  ).run(classId, sessionDate, description || null, eventType);
  req.flash('success', res.locals.t('class_day_added'));
  return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}?date=${sessionDate}`));
}));

app.post('/admin/classes/:id/schedule/type', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const sessionDate = typeof req.body.session_date === 'string' ? req.body.session_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    req.flash('error', res.locals.t('invalid_class_day'));
    return res.redirect(`/admin/classes/${classId}`);
  }
  const eventType = req.body.event_type;
  if (!isValidClassSessionEventType(eventType)) {
    req.flash('error', res.locals.t('invalid_class_day'));
    return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}`));
  }

  await db.prepare(
    'UPDATE ccd_class_session_dates SET event_type = ? WHERE ccd_class_id = ? AND session_date = ?'
  ).run(eventType, classId, sessionDate);
  req.flash('success', res.locals.t('class_day_type_saved'));
  return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}?date=${sessionDate}`));
}));

app.post('/admin/classes/:id/schedule/description', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const sessionDate = typeof req.body.session_date === 'string' ? req.body.session_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    req.flash('error', res.locals.t('invalid_class_day'));
    return res.redirect(`/admin/classes/${classId}`);
  }
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 255) : '';

  await db.prepare(
    'UPDATE ccd_class_session_dates SET description = ? WHERE ccd_class_id = ? AND session_date = ?'
  ).run(description || null, classId, sessionDate);
  req.flash('success', res.locals.t('class_day_description_saved'));
  return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}?date=${sessionDate}`));
}));

app.post('/admin/classes/:id/schedule/remove', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), asyncHandler(async (req, res) => {
  const classId = Number.parseInt(req.params.id, 10);
  const ccdClass = await getOwnedCcdClass(req, classId);
  if (!ccdClass) {
    req.flash('error', 'Class not found.');
    return res.redirect('/admin/classes');
  }

  const sessionDate = typeof req.body.session_date === 'string' ? req.body.session_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    req.flash('error', res.locals.t('invalid_class_day'));
    return res.redirect(`/admin/classes/${classId}`);
  }

  await db.prepare(
    'DELETE FROM ccd_class_session_dates WHERE ccd_class_id = ? AND session_date = ?'
  ).run(classId, sessionDate);
  req.flash('success', res.locals.t('class_day_removed'));
  return res.redirect(resolveScheduleRedirect(req.body.return_to, classId, `/admin/classes/${classId}`));
}));

app.post('/admin/classes/:id/message', requireAuth, requireRole('admin', 'catechist', 'family_faith_leader'), messageAttachmentUpload.array('attachments', 5), asyncHandler(async (req, res) => {
  // Attachments land on disk (uploadDir) as soon as multer parses the request, so every
  // exit path — validation failures included — must clean them up or they'd pile up.
  const uploadedFiles = req.files || [];
  const cleanupAttachments = () => {
    uploadedFiles.forEach((file) => fs.unlink(file.path, () => {}));
  };

  try {
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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const rawCcInput = (typeof req.body.cc_email === 'string' ? req.body.cc_email : '').trim();
    const ccEmails = rawCcInput
      .split(',')
      .map((address) => address.trim())
      .filter((address) => emailRegex.test(address));
    const ccList = ccEmails.length ? ccEmails.join(', ') : undefined;
    const ccAllInvalid = rawCcInput.length > 0 && ccEmails.length === 0;

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
    const enrolledRegistrationIds = await getEnrolledRegistrationIds();
    const activeAdultRegs = await getActiveAdultRegistrations();
    const activeFamilyFaithRegs = await getActiveFamilyFaithRegistrations();
    const selectedStudents = getClassRoster(ccdClass, activeStudentRegs, enrolledRegistrationIds, activeAdultRegs, activeFamilyFaithRegs, ccdClasses).filter((r) => selectedIds.has(r.id));

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

    const attachments = uploadedFiles.map((file) => ({ filename: file.originalname, path: file.path }));
    const senderName = req.user.full_name || req.user.email;
    const replyTo = req.user.email || undefined;
    const useBcc = req.body.send_mode === 'bcc';
    let sentCount = 0;
    let rejectedBcc = [];
    if (useBcc) {
      const bccList = Array.from(recipientsByEmail.values());
      const result = await sendClassMessageEmail({
        to: req.user.email,
        bcc: bccList.join(', '),
        subject,
        message,
        senderName,
        cc: ccList,
        replyTo,
        attachments,
      });
      if (result.delivered) {
        // sendMail() not throwing only means the SMTP server accepted the request — an
        // individual Bcc address can still bounce at the RCPT TO stage and come back in
        // result.rejected, so check that before counting it as sent.
        const rejectedSet = new Set((result.rejected || []).map((addr) => String(addr).toLowerCase()));
        rejectedBcc = bccList.filter((addr) => rejectedSet.has(addr.toLowerCase()));
        sentCount = bccList.length - rejectedBcc.length;
      }
    } else {
      for (const email of recipientsByEmail.values()) {
        const result = await sendClassMessageEmail({ to: email, subject, message, senderName, cc: ccList, replyTo, attachments });
        if (result.delivered) sentCount += 1;
      }
    }

    // Selected-count minus unique-recipient-count isn't the same as "missing an email" —
    // siblings sharing one parent email collapse into a single recipient too, which isn't
    // a problem worth reporting. Only students with no email at all are actually missing one.
    const missingEmailNames = selectedStudents
      .filter((r) => !(r.primary_contact_email || '').trim())
      .map((r) => r.student_full_name)
      .filter(Boolean);
    if (sentCount === 0) {
      req.flash('error', 'Message could not be sent — check the mail server configuration.');
    } else {
      if (ccAllInvalid) req.flash('error', 'The Cc address was not a valid email and was not included.');
      if (rejectedBcc.length) {
        console.warn('[admin] Class message Bcc partially rejected by SMTP server', { classId, rejected: rejectedBcc });
        req.flash('error', res.locals.t('class_message_bcc_partial')
          .replace('%s', sentCount)
          .replace('%s', sentCount + rejectedBcc.length)
          .replace('%s', rejectedBcc.join(', ')));
      }
      req.flash(
        'success',
        `Message sent to ${sentCount} famil${sentCount === 1 ? 'y' : 'ies'}` +
          (missingEmailNames.length ? ` (no contact email on file for: ${missingEmailNames.join(', ')}).` : '.')
      );
    }
    return res.redirect(`/admin/classes/${classId}`);
  } finally {
    cleanupAttachments();
  }
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

const getMyAltarServerEligibleChildren = (userId) => db.prepare(
  'SELECT id, student_full_name, ccd_grade_level, non_sacramental_grade, sacramental_year, is_altar_server FROM student_registrations WHERE user_id = ? ORDER BY student_full_name ASC'
).all(userId);

app.get('/altar-server-signup', requireAuth, asyncHandler(async (req, res) => {
  const trainingDates = await getAltarServerTrainingDates();
  const myChildren = await getMyAltarServerEligibleChildren(req.user.id);
  res.render('altar-server-signup', {
    trainingDates,
    myChildren,
    formData: {},
  });
}));

app.post('/altar-server-signup', requireAuth, asyncHandler(async (req, res) => {
  const trainingDates = await getAltarServerTrainingDates();
  const myChildren = await getMyAltarServerEligibleChildren(req.user.id);
  const trainingDateId = req.body.training_date_id ? Number.parseInt(req.body.training_date_id, 10) : null;
  const resolvedTrainingDateId = (trainingDateId && trainingDates.some((d) => d.id === trainingDateId)) ? trainingDateId : null;
  const existingRegistrationId = req.body.existing_registration_id ? Number.parseInt(req.body.existing_registration_id, 10) : null;

  if (existingRegistrationId) {
    const reg = await db.prepare(
      'SELECT id, student_id, student_full_name FROM student_registrations WHERE id = ? AND user_id = ?'
    ).get(existingRegistrationId, req.user.id);
    if (!reg) {
      req.flash('error', 'Please select one of your registered children.');
      return res.render('altar-server-signup', { trainingDates, myChildren, formData: req.body });
    }

    await db.prepare(
      'UPDATE student_registrations SET is_altar_server = 1, altar_server_training_date_id = ? WHERE id = ?'
    ).run(resolvedTrainingDateId, reg.id);
    if (reg.student_id) {
      await db.prepare(
        'UPDATE students SET is_altar_server = 1, altar_server_training_date_id = ? WHERE id = ?'
      ).run(resolvedTrainingDateId, reg.student_id);
    }

    req.flash('success', `Thank you! ${reg.student_full_name} has been signed up to serve at the altar.`);
    return res.redirect('/dashboard');
  }

  const childFirstName = typeof req.body.child_first_name === 'string' ? req.body.child_first_name.trim() : '';
  const childLastName = typeof req.body.child_last_name === 'string' ? req.body.child_last_name.trim() : '';
  const childDob = typeof req.body.child_dob === 'string' ? req.body.child_dob.trim() : '';

  if (!childFirstName || !childLastName) {
    req.flash('error', 'Please select one of your children, or enter a first and last name to add a new child.');
    return res.render('altar-server-signup', { trainingDates, myChildren, formData: req.body });
  }

  const studentFullName = `${childFirstName} ${childLastName}`;
  const faithFormationSettings = await getFaithFormationSettings();

  const insertedReg = await db.prepare(`
    INSERT INTO student_registrations
      (user_id, school_year, parent_name, primary_contact_email, primary_contact_phone, student_full_name, student_dob, status, is_altar_server, altar_server_training_date_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'admitted', 1, ?)
  `).run(
    req.user.id, faithFormationSettings.schoolYear,
    req.user.full_name || null, req.user.email || null, req.user.phone || null,
    studentFullName, childDob || null, resolvedTrainingDateId
  );

  const insertedStudent = await db.prepare(`
    INSERT INTO students
      (student_full_name, student_dob, parent_user_id, parent_name, primary_contact_email, primary_contact_phone, student_status, source_registration_id, is_altar_server, altar_server_training_date_id)
    VALUES (?, ?, ?, ?, ?, ?, 'enrolled', ?, 1, ?)
  `).run(
    studentFullName, childDob || null, req.user.id,
    req.user.full_name || null, req.user.email || null, req.user.phone || null,
    insertedReg.lastInsertRowid, resolvedTrainingDateId
  );
  await db.prepare('UPDATE student_registrations SET student_id = ? WHERE id = ?')
    .run(insertedStudent.lastInsertRowid, insertedReg.lastInsertRowid);

  req.flash('success', `Thank you! ${studentFullName} has been signed up to serve at the altar.`);
  return res.redirect('/dashboard');
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
