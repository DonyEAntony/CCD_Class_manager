require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const passport = require('./auth');
const db = require('./db');
const { processScanDocument, verifyDocumentAiConfiguration } = require('./document-ai');
const { sendVerificationEmail, smtpLogConfig, verifyMailConfiguration } = require('./mailer');
const { requireAuth, requireRole } = require('./middleware');

const app = express();
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
  'completed',
  'cancelled',
  'discontinued',
  'graduated',
];

const translations = {
  en: {
    app_title: 'Saint Matthew Catholic Church',
    reg_title: 'Register for Faith Formation and Sacramental Preparation',
    school_year: 'School Year 2025-2026',
    landing_focus_title: 'Faith Formation & Sacramental Readiness',
    landing_focus_subtitle: 'For children, OCIA candidates, and adult faith formation events',
    secure_online: 'Secure online registration for families, catechists, administrators, and formation participants.',
    create_account: 'Create Account',
    login: 'Login',
    logout: 'Logout',
    open_dashboard: 'Open Dashboard',
    dashboard: 'Dashboard',
    signed_in_as: 'Signed in as',
    new_registration: 'New Registration',
    calendar: 'Calendar',
    manage_users: 'Admin Panel',
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
    back_to_dashboard: 'Back to Dashboard',
    email: 'Email',
    role: 'Role',
    provider: 'Provider',
    update_role: 'Update Role',
    save: 'Save',
    create_login: 'Create Account',
    full_name: 'Full Name',
    first_name: 'First Name',
    last_name: 'Last Name',
    password: 'Password',
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
    baptism_required: 'Baptism Certificate (required if first year)',
    communion_required: 'First Holy Communion Certificate (required for 3rd grade+)',
    fee_notice: 'Fees: $150 one child / $200 family; sacramental fee $25 for second grade/SS2, $50 for second-year Confirmation. Late fee $50 after Aug 15, 2025. No registrations accepted after Sept 8, 2025.',
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
    adult_programs: 'Adult Programs',
    no_children_regs: 'No children\'s registrations yet.',
    no_adult_regs: 'No adult program registrations yet.',
    faith_formation_children: 'Faith Formation — Children',
    adult_program_regs: 'Adult Program Registrations',
    name_col: 'Name',
    program_col: 'Program',
    date_col: 'Date',
    // Program cards
    prog_children_title: 'Faith Formation for Children',
    prog_children_subtitle: 'School Year 2025–2026',
    prog_children_desc: 'Register a child for CCD classes, sacramental preparation (First Communion, Confirmation), and weekly faith formation.',
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
    in_progress: 'In Progress',
    conditionally_accepted: 'Conditionally Accepted',
    completed: 'Completed',
    cancelled: 'Cancelled',
    discontinued: 'Discontinued',
    graduated: 'Graduated',
  },
  es: {
    app_title: 'Iglesia Católica San Mateo',
    reg_title: 'Inscríbete para Formación en la Fe y Preparación Sacramental',
    school_year: 'Año Escolar 2025-2026',
    landing_focus_title: 'Formación en la fe y preparación sacramental',
    landing_focus_subtitle: 'Para niños, candidatos de OCIA y eventos de formación en la fe para adultos',
    secure_online: 'Inscripción segura en línea para familias, catequistas, administradores y participantes de formación.',
    create_account: 'Crear Cuenta',
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    open_dashboard: 'Abrir Panel',
    dashboard: 'Panel',
    signed_in_as: 'Conectado como',
    new_registration: 'Nueva Inscripción',
    calendar: 'Calendario',
    manage_users: 'Panel de Administracion',
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
    back_to_dashboard: 'Volver al Panel',
    email: 'Correo Electrónico',
    role: 'Rol',
    provider: 'Proveedor',
    update_role: 'Actualizar Rol',
    save: 'Guardar',
    create_login: 'Crear Cuenta',
    full_name: 'Nombre Completo',
    first_name: 'Nombre',
    last_name: 'Apellido',
    password: 'Contraseña',
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
    baptism_required: 'Certificado de Bautismo (requerido si es el primer año)',
    communion_required: 'Certificado de Primera Comunión (requerido para 3er grado en adelante)',
    fee_notice: 'Cuotas: $150 por un hijo / $200 por familia; cuota sacramental de $25 para segundo grado/SS2, $50 para segundo año de Confirmación. Recargo de $50 después del 15 de agosto de 2025.',
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
    adult_programs: 'Programas para Adultos',
    no_children_regs: 'No hay inscripciones de niños todavía.',
    no_adult_regs: 'No hay inscripciones de programas para adultos todavía.',
    faith_formation_children: 'Formación en la Fe — Niños',
    adult_program_regs: 'Inscripciones de Programas para Adultos',
    name_col: 'Nombre',
    program_col: 'Programa',
    date_col: 'Fecha',
    // Program cards
    prog_children_title: 'Formación en la Fe para Niños',
    prog_children_subtitle: 'Año Escolar 2025–2026',
    prog_children_desc: 'Inscriba a un niño para clases de catecismo, preparación sacramental (Primera Comunión, Confirmación) y formación en la fe semanal.',
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
    scan_legacy_desc: 'Use la cÃ¡mara del telÃ©fono para capturar un formulario en papel y rellenar un borrador.',
    open_scanner: 'Abrir escÃ¡ner',
    camera_capture: 'Captura de cÃ¡mara',
    extract_text: 'Extraer texto',
    processing_scan: 'Procesando escaneo con Google Document AI...',
    scan_google_ready: 'Google Document AI',
    document_ai_health: 'Estado de Document AI',
    document_ai_failed: 'No se pudo procesar el documento escaneado.',
    ocr_text: 'Texto escaneado',
    review_imported_fields: 'Revisar campos importados',
    open_registration_draft: 'Abrir borrador de registro',
    imported_draft_ready: 'Borrador importado guardado. Revise y envÃ­e el formulario de registro.',
    // Status
    status: 'Estado',
    current_status: 'Estado actual',
    update_status: 'Actualizar estado',
    status_updated: 'Estado de registro actualizado.',
    save_draft: 'Guardar Borrador',
    actions: 'Acciones',
    edit: 'Editar',
    in_progress: 'En progreso',
    conditionally_accepted: 'Aceptado Condicionalmente',
    completed: 'Completado',
    cancelled: 'Cancelado',
    discontinued: 'Discontinuado',
    graduated: 'Graduado',
  }
};
// ── Adult program metadata (locale-aware) ───────────────────
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

const getCcdClasses = async () =>
  db.prepare('SELECT id, grade_level, class_time, classroom FROM ccd_classes ORDER BY grade_level ASC').all();
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
const getFaithFormationEvents = async (audiences = []) => {
  const audienceList = Array.from(new Set((Array.isArray(audiences) ? audiences : [audiences]).filter(Boolean)));
  if (!audienceList.length) return [];
  const placeholders = audienceList.map(() => '?').join(', ');
  return db.prepare(
    `SELECT schedules.id, definitions.title, definitions.audience, schedules.schedule_type, schedules.recurrence_pattern, schedules.event_date, schedules.event_time, schedules.event_end_time, schedules.location
     FROM faith_formation_event_schedules schedules
     INNER JOIN faith_formation_event_definitions definitions
       ON definitions.id = schedules.event_definition_id
     WHERE definitions.audience IN (${placeholders})
     ORDER BY event_date ASC, event_time ASC, title ASC`
  ).all(...audienceList);
};
const getBaptismPrepSchedules = async () => getFaithFormationEvents(['baptism_prep']);
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

app.set('view engine', 'ejs');
app.locals.lang = 'en';
app.locals.t = (key) => translations.en[key] || key;
app.locals.user = null;
app.locals.success = [];
app.locals.error = [];
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(flash());
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
  res.locals.t = (key) => translations[lang][key] || translations.en[key] || key;
  res.locals.user = req.user;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  next();
});

const calculateFees = (familyCount, gradeLevel, registrationDateStr) => {
  const registrationFee = Number(familyCount) > 1 ? 200 : 150;
  const grade = `${gradeLevel}`.toLowerCase();
  const sacramentalFee = grade.includes('2') ? 25 : grade.includes('confirmation') ? 50 : 0;
  const registrationDate = registrationDateStr ? new Date(registrationDateStr) : new Date();
  const deadline = new Date('2025-08-15T23:59:59');
  const classesBegin = new Date('2025-09-08T00:00:00');
  const lateFee = registrationDate > deadline && registrationDate < classesBegin ? 50 : 0;
  return { registrationFee, sacramentalFee, lateFee, afterStart: registrationDate >= classesBegin };
};

const createVerificationToken = () => crypto.randomBytes(32).toString('hex');
const hashVerificationToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const getBaseUrl = (req) => process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
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
  const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
  if (!phoneRegex.test(trimmedPhone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    return res.redirect('/signup');
  }
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) {
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
  const verificationToken = createVerificationToken();
  const verificationTokenHash = hashVerificationToken(verificationToken);
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO users (
      email, password_hash, role, provider, full_name, first_name, last_name, phone, is_active, email_verification_token, email_verification_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    normalizedEmail,
    hash,
    role,
    'local',
    trimmedFullName,
    trimmedFirstName,
    trimmedLastName,
    trimmedPhone,
    verificationTokenHash,
    verificationExpiresAt,
  );

  const verificationUrl = `${getBaseUrl(req)}/verify-email?token=${verificationToken}`;
  console.info('[signup] Created inactive user pending verification', {
    email: normalizedEmail,
    role,
    baseUrl: getBaseUrl(req),
  });

  try {
    const delivery = await sendVerificationEmail({
      to: normalizedEmail,
      verificationUrl,
      fullName: trimmedFullName,
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
    await db.prepare('DELETE FROM users WHERE email = ? AND is_active = 0').run(normalizedEmail);
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
    SELECT id, email, is_active, email_verification_expires_at
    FROM users
    WHERE email_verification_token = ?
  `).get(tokenHash);

  if (!user) {
    req.flash('error', 'Verification link is invalid or has already been used.');
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

// ── Dashboard ────────────────────────────────────────────────
app.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const isStaff = req.user.role === 'admin' || req.user.role === 'catechist';

  const studentRegs = isStaff
    ? await db.prepare('SELECT * FROM student_registrations ORDER BY created_at DESC').all()
    : await db.prepare('SELECT * FROM student_registrations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  const adultRegs = isStaff
    ? await db.prepare('SELECT * FROM adult_registrations ORDER BY created_at DESC').all()
    : await db.prepare('SELECT * FROM adult_registrations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  const ADULT_PROGRAMS = getAdultPrograms(res.locals.t);
  res.render('dashboard', { studentRegs, adultRegs, ADULT_PROGRAMS });
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
  const today = new Date().toISOString().slice(0, 10);
  res.render('registration-form', {
    today,
    reg: null,
    editing: false,
    isStaff: false,
    statusOptions: STUDENT_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['children', 'general']),
  });
}));

const handleChildrenRegistration = asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const requestedStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
    if (requestedStatus && !STUDENT_REGISTRATION_STATUSES.includes(requestedStatus)) {
      req.flash('error', 'Invalid registration status.');
      const redirectUrl = req.body.registration_id ? `/registration/children/edit/${req.body.registration_id}` : '/registration/children';
      return res.redirect(redirectUrl);
    }

    // Calculate family_count from number of students entered
    const studentNamesForFees = Array.isArray(req.body.student_full_name) ? req.body.student_full_name : (req.body.student_full_name ? [req.body.student_full_name] : []);
    const familyCount = studentNamesForFees.filter(name => (name || '').trim()).length || 1;
    const fees = calculateFees(familyCount, req.body.ccd_grade_level, null);
    if (fees.afterStart) {
      req.flash('error', 'Registration closed: no registrations accepted after classes begin on Sept. 8, 2025.');
      return res.redirect('/registration/children');
    }

    // Server-side validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(req.body.primary_contact_email)) {
      req.flash('error', 'Invalid email format.');
      const redirectUrl = req.body.registration_id ? `/registration/children/edit/${req.body.registration_id}` : '/registration/children';
      return res.redirect(redirectUrl);
    }
    const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
    if (!phoneRegex.test(req.body.primary_contact_phone)) {
      req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
      const redirectUrl = req.body.registration_id ? `/registration/children/edit/${req.body.registration_id}` : '/registration/children';
      return res.redirect(redirectUrl);
    }

    // Ensure every entered student has first/last name + gender + birthdate
    const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const studentFirstNames = toArray(req.body.student_first_name);
    const studentMiddleNames = toArray(req.body.student_middle_name);
    const studentLastNames = toArray(req.body.student_last_name);
    const studentGenders = toArray(req.body.student_gender);
    const studentDobs = toArray(req.body.student_dob);

    for (let i = 0; i < studentFirstNames.length; i++) {
      const firstName = (studentFirstNames[i] || '').trim();
      const lastName = (studentLastNames[i] || '').trim();
      if (!firstName && !lastName) continue;
      const gender = (studentGenders[i] || '').trim();
      const dob = (studentDobs[i] || '').trim();
      if (!firstName || !lastName || !gender || !dob) {
        req.flash('error', 'Each student must have first name, last name, gender, and date of birth.');
        const redirectUrl = req.body.registration_id ? `/registration/children/edit/${req.body.registration_id}` : '/registration/children';
        return res.redirect(redirectUrl);
      }
    }

    req.body.ccd_grade_level = req.body.ccd_grade_level || [];

    // Build student_full_name array for storage (historic)/display
    const studentFullNames = studentFirstNames.map((first, idx) => {
      const middle = (studentMiddleNames[idx] || '').trim();
      const last = (studentLastNames[idx] || '').trim();
      if (!first && !last) return '';
      return [first.trim(), middle, last].filter(Boolean).join(' ');
    });

    // Build birthplace merged string for legacy and keep new columns
    const childPlaceOfBirthCity = toArray(req.body.child_place_of_birth_city);
    const childPlaceOfBirthCountry = toArray(req.body.child_place_of_birth_country);
    const childPlaceOfBirthLegacy = childPlaceOfBirthCity.map((city, idx) => {
      const country = (childPlaceOfBirthCountry[idx] || '').trim();
      if (!city && !country) return '';
      return [city.trim(), country].filter(Boolean).join(', ');
    });

    const baptismCert = req.files?.baptism_certificate?.[0]?.path || null;
    const communionCert = req.files?.first_communion_certificate?.[0]?.path || null;

    if (req.body.registration_id) {
      const existingReg = await db.prepare(
        'SELECT id, status FROM student_registrations WHERE id = ? AND (user_id = ? OR ? = 1)'
      ).get(req.body.registration_id, req.user.id, isAdmin ? 1 : 0);
      if (!existingReg) {
        return res.status(404).send('Registration not found.');
      }

      const nextStatus = isAdmin && requestedStatus ? requestedStatus : existingReg.status;

      // Update existing
      await db.prepare(`
        UPDATE student_registrations SET
          parent_name = ?, primary_contact_first_name = ?, primary_contact_last_name = ?,
          primary_contact_phone = ?, primary_contact_email = ?,
          primary_contact_relationship = ?, primary_contact_relationship_other = ?,
          address = ?, city_state_zip = ?, home_phone = ?,
          father_name = ?, father_religion = ?, father_cell = ?,
          mother_maiden_name = ?, mother_religion = ?, mother_cell = ?,
          child_lives_with = ?, step_parent_name = ?, step_parent_religion = ?,
          student_full_name = ?, student_gender = ?,
          student_dob = ?, child_place_of_birth = ?, child_place_of_birth_city = ?, child_place_of_birth_country = ?, ccd_grade_level = ?,
          school_attending = ?, school_grade_level = ?,
          baptism_date = ?, baptism_church = ?,
          first_communion_date = ?, first_communion_church = ?,
          disabilities_comments = ?, parent_signature = ?, email = ?,
          registration_fee = ?, sacramental_fee = ?, late_fee = ?,
          baptism_certificate_path = ?, first_communion_certificate_path = ?, status = ?
        WHERE id = ? AND (user_id = ? OR ? = 1)
      `).run(
        `${req.body.primary_contact_first_name} ${req.body.primary_contact_last_name}`,
        req.body.primary_contact_first_name, req.body.primary_contact_last_name,
        req.body.primary_contact_phone, req.body.primary_contact_email,
        req.body.primary_contact_relationship,
        req.body.primary_contact_relationship === 'Other' ? req.body.primary_contact_relationship_other : null,
        req.body.address, `${req.body.city}, ${req.body.state} ${req.body.zip}`, req.body.home_phone,
        req.body.father_name, req.body.father_religion, req.body.father_cell,
        req.body.mother_maiden_name, req.body.mother_religion, req.body.mother_cell,
        req.body.child_lives_with, req.body.step_parent_name, req.body.step_parent_religion,
        studentFullNames, req.body.student_gender,
        req.body.student_dob, childPlaceOfBirthLegacy, childPlaceOfBirthCity.join(','), childPlaceOfBirthCountry.join(','), req.body.ccd_grade_level,
        req.body.school_attending, req.body.school_grade_level,
        req.body.baptism_date, req.body.baptism_church,
        req.body.first_communion_date, req.body.first_communion_church,
        req.body.disabilities_comments, req.body.parent_signature, req.body.email,
        fees.registrationFee, fees.sacramentalFee, fees.lateFee,
        baptismCert, communionCert, nextStatus,
        req.body.registration_id, req.user.id, isAdmin ? 1 : 0
      );
      req.flash('success', 'Registration updated.');
      return res.redirect('/dashboard');
    }

    await db.prepare(`
      INSERT INTO student_registrations (
        user_id, school_year, parent_name, primary_contact_first_name, primary_contact_last_name,
        primary_contact_phone, primary_contact_email,
        primary_contact_relationship, primary_contact_relationship_other, address, city_state_zip, home_phone,
        father_name, father_religion, father_cell, mother_maiden_name, mother_religion, mother_cell,
        child_lives_with, step_parent_name, step_parent_religion, student_full_name, student_gender,
        student_dob, child_place_of_birth, child_place_of_birth_city, child_place_of_birth_country, ccd_grade_level, school_attending,
        school_grade_level, baptism_date, baptism_church, first_communion_date, first_communion_church,
        disabilities_comments, parent_signature, email, registration_fee, sacramental_fee, late_fee,
        baptism_certificate_path, first_communion_certificate_path, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, req.body.school_year || '2025-2026',
      `${req.body.primary_contact_first_name} ${req.body.primary_contact_last_name}`,
      req.body.primary_contact_first_name, req.body.primary_contact_last_name,
      req.body.primary_contact_phone, req.body.primary_contact_email,
      req.body.primary_contact_relationship,
      req.body.primary_contact_relationship === 'Other' ? req.body.primary_contact_relationship_other : null,
      req.body.address, `${req.body.city}, ${req.body.state} ${req.body.zip}`, req.body.home_phone,
      req.body.father_name, req.body.father_religion, req.body.father_cell,
      req.body.mother_maiden_name, req.body.mother_religion, req.body.mother_cell,
      req.body.child_lives_with, req.body.step_parent_name, req.body.step_parent_religion,
      studentFullNames, req.body.student_gender,
      req.body.student_dob, childPlaceOfBirthLegacy, childPlaceOfBirthCity.join(','), childPlaceOfBirthCountry.join(','), req.body.ccd_grade_level,
      req.body.school_attending, req.body.school_grade_level,
      req.body.baptism_date, req.body.baptism_church,
      req.body.first_communion_date, req.body.first_communion_church,
      req.body.disabilities_comments, req.body.parent_signature, req.body.email,
      fees.registrationFee, fees.sacramentalFee, fees.lateFee,
      baptismCert, communionCert, 'in_progress',
    );

    req.flash('success', `Registration submitted. Total fees: $${fees.registrationFee + fees.sacramentalFee + fees.lateFee}`);
    return res.redirect('/dashboard');
});

app.post(
  '/registration/children',
  requireAuth,
  upload.fields([
    { name: 'baptism_certificate', maxCount: 1 },
    { name: 'first_communion_certificate', maxCount: 1 },
  ]),
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
    statusOptions: STUDENT_REGISTRATION_STATUSES,
    relevantEvents: await getFaithFormationEvents(['children', 'general']),
  });
}));

// ── Adult Programs ───────────────────────────────────────────
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

  // Server-side validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (req.body.email && !emailRegex.test(req.body.email)) {
    req.flash('error', 'Invalid email format.');
    const redirectUrl = req.body.registration_id ? `/registration/adult/edit/${program.key}/${req.body.registration_id}` : `/registration/adult/${program.key}`;
    return res.redirect(redirectUrl);
  }
  const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
  if (req.body.phone && !phoneRegex.test(req.body.phone)) {
    req.flash('error', 'Invalid phone format. Use XXX-XXX-XXXX, XXX.XXX.XXXX, or XXX XXX XXXX.');
    const redirectUrl = req.body.registration_id ? `/registration/adult/edit/${program.key}/${req.body.registration_id}` : `/registration/adult/${program.key}`;
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
      const redirectUrl = req.body.registration_id ? `/registration/adult/edit/${program.key}/${req.body.registration_id}` : `/registration/adult/${program.key}`;
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
      req.body.full_name,
      req.body.email,
      req.body.phone,
      req.body.address,
      `${req.body.city}, ${req.body.state} ${req.body.zip}`,
      req.body.dob,
      req.body.baptized,
      req.body.baptism_church,
      req.body.spouse_name,
      req.body.godparent_for,
      req.body.comments,
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
    req.body.full_name,
    req.body.email,
    req.body.phone,
    req.body.address,
    `${req.body.city}, ${req.body.state} ${req.body.zip}`,
    req.body.dob,
    req.body.baptized,
    req.body.baptism_church,
    req.body.spouse_name,
    req.body.godparent_for,
    req.body.comments,
    program.key === 'baptism_prep' ? selectedClassScheduleId : null,
    program.key === 'baptism_prep' && selectedBaptismPrepSchedule ? formatScheduledEventLabel(selectedBaptismPrepSchedule) : null,
    'in_progress',
  );

  req.flash('success', `Your ${program.title} registration has been submitted. The parish office will be in touch.`);
  return res.redirect('/dashboard');
}));

// ── Admin ────────────────────────────────────────────────────
app.get('/admin/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const users = await db.prepare('SELECT id, email, role, provider, created_at FROM users ORDER BY created_at DESC').all();
  const ccdClasses = await getCcdClasses();
  const eventDefinitions = await getFaithFormationEventDefinitions();
  const managedEvents = await getFaithFormationEvents(['children', 'baptism_prep', 'ocia', 'general']);
  res.render('admin-users', { users, ccdClasses, eventDefinitions, managedEvents });
}));

app.get('/admin/scan-registration', requireAuth, requireRole('admin'), (req, res) => {
  res.render('admin-scan-registration');
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

app.post('/admin/users/:id/role', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
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

  await db.prepare('DELETE FROM student_registrations WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM adult_registrations WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  req.flash('success', `Removed user ${existingUser.email}.`);
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
    `INSERT INTO ccd_classes (grade_level, class_time, classroom)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE class_time = VALUES(class_time), classroom = VALUES(classroom)`
  ).run(gradeLevel, classTime, classroom);
  req.flash('success', 'CCD class saved.');
  return res.redirect('/admin/users');
}));

app.post('/admin/ccd-classes/:id/delete', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM ccd_classes WHERE id = ?').run(req.params.id);
  req.flash('success', 'CCD class removed.');
  return res.redirect('/admin/users');
}));

app.post('/admin/events', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const audience = typeof req.body.audience === 'string' ? req.body.audience.trim() : '';
  const validAudiences = ['children', 'baptism_prep', 'ocia', 'general'];

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
  upload.fields([{ name: 'baptism_certificate', maxCount: 1 }, { name: 'first_communion_certificate', maxCount: 1 }]),
  handleChildrenRegistration
);

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
