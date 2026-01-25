export interface SacramentInfo {
  date: string;
  churchName: string;
  city: string;
  state: string;
}

export interface RegistrationRequest {
  parentName: string;
  address: string;
  cityStateZip: string;
  homePhone: string;
  fatherName: string;
  fatherReligion: string;
  fatherCellPhone: string;
  motherMaidenName: string;
  motherReligion: string;
  motherCellPhone: string;
  childLivesWith: string;
  stepParentName: string;
  stepParentReligion: string;
  studentFullName: string;
  gender: string;
  age: number;
  dateOfBirth: string;
  placeOfBirth: string;
  ccdGradeLevel: string;
  schoolAttending: string;
  schoolGradeLevel: string;
  baptism: SacramentInfo;
  firstCommunion: SacramentInfo;
  learningNotes: string;
  firstYear: boolean;
  parentSignature: string;
  email: string;
}

export interface RegistrationRecord {
  id: string;
  details: RegistrationRequest;
  submittedAt: string;
  documentsRequested: Array<{ documentType: string; notes: string; requestedAt: string }>;
  admission?: {
    classCode: string;
    status: string;
    adminNotes: string;
    updatedAt: string;
  };
}

export interface ClassSchedule {
  year: string;
  blocks: ClassBlock[];
  events: SpecialEvent[];
}

export interface ClassBlock {
  day: string;
  time: string;
  grades: string[];
  months: Array<{ month: string; dates: string }>;
}

export interface SpecialEvent {
  title: string;
  date: string;
  time: string;
}
