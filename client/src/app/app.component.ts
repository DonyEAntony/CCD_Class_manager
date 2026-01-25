import { Component, OnInit } from '@angular/core';
import { ClassSchedule, RegistrationRecord, RegistrationRequest } from './models';
import { RegistrationService } from './registration.service';

const fallbackSchedule: ClassSchedule = {
  year: '2025-2026',
  blocks: [
    {
      day: 'Monday',
      time: '4:00 to 5:15',
      grades: ['1A', '2A', '4A'],
      months: [
        { month: 'September', dates: '8, 15, 22, 29' },
        { month: 'October', dates: '6, 20, 27' },
        { month: 'November', dates: '3, 17' },
        { month: 'December', dates: '1, 15' },
        { month: 'January', dates: '5, 12, 26' },
        { month: 'February', dates: '2, 9, 23' },
        { month: 'March', dates: '2, 9, 30' },
        { month: 'April', dates: '13, 20, 27' },
        { month: 'May', dates: '4' },
      ],
    },
    {
      day: 'Monday',
      time: '5:30 to 6:45',
      grades: ['1B', '2B', 'SS1', '6A'],
      months: [
        { month: 'February', dates: '2, 9, 23' },
        { month: 'March', dates: '2, 9, 30' },
        { month: 'April', dates: '13, 20, 27' },
        { month: 'May', dates: '4' },
      ],
    },
    {
      day: 'Tuesday',
      time: '4:00 to 5:15',
      grades: ['1C', '2C', '3A'],
      months: [
        { month: 'September', dates: '9, 16, 23, 30' },
        { month: 'October', dates: '7, 21, 28' },
        { month: 'November', dates: '4, 18' },
        { month: 'December', dates: '2, 16' },
        { month: 'January', dates: '6, 13, 27' },
        { month: 'February', dates: '3, 10, 24' },
        { month: 'March', dates: '3, 10, 31' },
        { month: 'April', dates: '14, 21, 28' },
        { month: 'May', dates: '5' },
      ],
    },
    {
      day: 'Wednesday',
      time: '4:00 to 5:15',
      grades: ['1D', '2D', '5A'],
      months: [
        { month: 'September', dates: '10, 17, 24' },
        { month: 'October', dates: '1, 8, 22, 29' },
        { month: 'November', dates: '5, 19' },
        { month: 'December', dates: '3, 17' },
        { month: 'January', dates: '7, 14, 28' },
        { month: 'February', dates: '4, 11, 25' },
        { month: 'March', dates: '4, 11' },
        { month: 'April', dates: '1, 15, 22, 29' },
        { month: 'May', dates: '6' },
      ],
    },
    {
      day: 'Sunday',
      time: '12:00 to 2:30',
      grades: ['7A', '1st year confirmation', '2nd year confirmation'],
      months: [
        { month: 'September', dates: '14, 28' },
        { month: 'October', dates: '5, 26' },
        { month: 'November', dates: '2, 16' },
        { month: 'December', dates: '7, 14' },
        { month: 'January', dates: '4, 11, 25' },
        { month: 'February', dates: '1, 8, 22' },
        { month: 'March', dates: '1, 8' },
        { month: 'April', dates: '19, 26' },
        { month: 'May', dates: '3' },
      ],
    },
  ],
  events: [
    { title: 'First Holy Communion Practice', date: 'Friday May 8th', time: '6:00 pm' },
    { title: 'First Holy Communion', date: 'Saturday May 9th', time: '10:00 am' },
    { title: 'Confirmation Practice', date: 'Friday May 29th 2026', time: '6:00 pm' },
    { title: 'Confirmation', date: 'May 31st 2026', time: '12:00 pm' },
  ],
};

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  schedule: ClassSchedule = fallbackSchedule;
  registrations: RegistrationRecord[] = [];
  submittedMessage = '';
  formData: RegistrationRequest = {
    parentName: '',
    address: '',
    cityStateZip: '',
    homePhone: '',
    fatherName: '',
    fatherReligion: '',
    fatherCellPhone: '',
    motherMaidenName: '',
    motherReligion: '',
    motherCellPhone: '',
    childLivesWith: 'Both',
    stepParentName: '',
    stepParentReligion: '',
    studentFullName: '',
    gender: '',
    age: 0,
    dateOfBirth: '',
    placeOfBirth: '',
    ccdGradeLevel: '',
    schoolAttending: '',
    schoolGradeLevel: '',
    baptism: {
      date: '',
      churchName: '',
      city: '',
      state: '',
    },
    firstCommunion: {
      date: '',
      churchName: '',
      city: '',
      state: '',
    },
    learningNotes: '',
    firstYear: false,
    parentSignature: '',
    email: '',
  };

  adminRequest = {
    registrationId: '',
    documentType: 'Baptismal Certificate',
    notes: '',
    classCode: '',
    status: 'Admitted',
    adminNotes: '',
  };

  constructor(private readonly registrationService: RegistrationService) {}

  ngOnInit(): void {
    this.registrationService.getSchedule().subscribe({
      next: (schedule) => (this.schedule = schedule),
      error: () => {
        this.schedule = fallbackSchedule;
      },
    });
    this.refreshRegistrations();
  }

  submit(): void {
    this.registrationService.submitRegistration(this.formData).subscribe((record) => {
      this.submittedMessage = `Thanks ${record.details.parentName}! Your registration has been received.`;
      this.resetForm();
      this.refreshRegistrations();
    });
  }

  refreshRegistrations(): void {
    this.registrationService.getRegistrations().subscribe((records) => (this.registrations = records));
  }

  requestDocuments(): void {
    if (!this.adminRequest.registrationId) {
      return;
    }

    this.registrationService
      .requestDocuments(this.adminRequest.registrationId, this.adminRequest.documentType, this.adminRequest.notes)
      .subscribe(() => this.refreshRegistrations());
  }

  admitStudent(): void {
    if (!this.adminRequest.registrationId) {
      return;
    }

    this.registrationService
      .admitStudent(
        this.adminRequest.registrationId,
        this.adminRequest.classCode,
        this.adminRequest.status,
        this.adminRequest.adminNotes
      )
      .subscribe(() => this.refreshRegistrations());
  }

  private resetForm(): void {
    this.formData = {
      ...this.formData,
      parentName: '',
      address: '',
      cityStateZip: '',
      homePhone: '',
      fatherName: '',
      fatherReligion: '',
      fatherCellPhone: '',
      motherMaidenName: '',
      motherReligion: '',
      motherCellPhone: '',
      stepParentName: '',
      stepParentReligion: '',
      studentFullName: '',
      gender: '',
      age: 0,
      dateOfBirth: '',
      placeOfBirth: '',
      ccdGradeLevel: '',
      schoolAttending: '',
      schoolGradeLevel: '',
      baptism: { date: '', churchName: '', city: '', state: '' },
      firstCommunion: { date: '', churchName: '', city: '', state: '' },
      learningNotes: '',
      firstYear: false,
      parentSignature: '',
      email: '',
    };
  }
}
