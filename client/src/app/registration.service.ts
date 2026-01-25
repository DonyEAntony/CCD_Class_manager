import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ClassSchedule, RegistrationRecord, RegistrationRequest } from './models';

@Injectable({
  providedIn: 'root',
})
export class RegistrationService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getSchedule() {
    return this.http.get<ClassSchedule>(`${this.baseUrl}/classes`);
  }

  submitRegistration(payload: RegistrationRequest) {
    return this.http.post<RegistrationRecord>(`${this.baseUrl}/registrations`, payload);
  }

  getRegistrations() {
    return this.http.get<RegistrationRecord[]>(`${this.baseUrl}/registrations`);
  }

  requestDocuments(id: string, documentType: string, notes: string) {
    return this.http.post<RegistrationRecord>(`${this.baseUrl}/registrations/${id}/documents`, {
      documentType,
      notes,
    });
  }

  admitStudent(id: string, classCode: string, status: string, adminNotes: string) {
    return this.http.post<RegistrationRecord>(`${this.baseUrl}/registrations/${id}/admit`, {
      classCode,
      status,
      adminNotes,
    });
  }
}
