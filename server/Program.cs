using System.ComponentModel.DataAnnotations;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors();

var registrations = new List<Registration>();
var classSchedule = ClassSchedule.BuildDefault();

app.MapGet("/api/classes", () => Results.Ok(classSchedule));

app.MapGet("/api/registrations", () => Results.Ok(registrations));

app.MapPost("/api/registrations", (RegistrationRequest request) =>
{
    var validationResults = new List<ValidationResult>();
    if (!Validator.TryValidateObject(request, new ValidationContext(request), validationResults, true))
    {
        return Results.BadRequest(validationResults);
    }

    var registration = Registration.FromRequest(request);
    registrations.Add(registration);
    return Results.Created($"/api/registrations/{registration.Id}", registration);
});

app.MapPost("/api/registrations/{id:guid}/documents", (Guid id, DocumentRequest request) =>
{
    var registration = registrations.FirstOrDefault(r => r.Id == id);
    if (registration is null)
    {
        return Results.NotFound();
    }

    registration.DocumentsRequested.Add(new DocumentChecklistItem(
        request.DocumentType,
        request.Notes,
        DateTimeOffset.UtcNow));

    return Results.Ok(registration);
});

app.MapPost("/api/registrations/{id:guid}/admit", (Guid id, AdmissionRequest request) =>
{
    var registration = registrations.FirstOrDefault(r => r.Id == id);
    if (registration is null)
    {
        return Results.NotFound();
    }

    registration.Admission = new AdmissionDecision(
        request.ClassCode,
        request.Status,
        request.AdminNotes,
        DateTimeOffset.UtcNow);

    return Results.Ok(registration);
});

app.Run();

record RegistrationRequest
(
    [property: Required] string ParentName,
    [property: Required] string Address,
    [property: Required] string CityStateZip,
    string? HomePhone,
    [property: Required] string FatherName,
    string? FatherReligion,
    string? FatherCellPhone,
    string? MotherMaidenName,
    string? MotherReligion,
    string? MotherCellPhone,
    string? ChildLivesWith,
    string? StepParentName,
    string? StepParentReligion,
    [property: Required] string StudentFullName,
    [property: Required] string Gender,
    [property: Range(1, 18)] int Age,
    [property: Required] DateOnly DateOfBirth,
    string? PlaceOfBirth,
    [property: Required] string CcdGradeLevel,
    [property: Required] string SchoolAttending,
    string? SchoolGradeLevel,
    SacramentInfo Baptism,
    SacramentInfo FirstCommunion,
    string? LearningNotes,
    bool FirstYear,
    string? ParentSignature,
    [property: EmailAddress] string? Email
);

record SacramentInfo(string? Date, string? ChurchName, string? City, string? State);

record Registration
(
    Guid Id,
    RegistrationRequest Details,
    DateTimeOffset SubmittedAt,
    List<DocumentChecklistItem> DocumentsRequested,
    AdmissionDecision? Admission
)
{
    public static Registration FromRequest(RegistrationRequest request) => new(
        Guid.NewGuid(),
        request,
        DateTimeOffset.UtcNow,
        new List<DocumentChecklistItem>(),
        null);
}

record DocumentRequest([property: Required] string DocumentType, string? Notes);

record AdmissionRequest(
    [property: Required] string ClassCode,
    [property: Required] string Status,
    string? AdminNotes
);

record DocumentChecklistItem(string DocumentType, string? Notes, DateTimeOffset RequestedAt);

record AdmissionDecision(string ClassCode, string Status, string? AdminNotes, DateTimeOffset UpdatedAt);

record ClassSchedule(string Year, IReadOnlyList<ClassBlock> Blocks, IReadOnlyList<SpecialEvent> Events)
{
    public static ClassSchedule BuildDefault() => new(
        "2025-2026",
        new List<ClassBlock>
        {
            new(
                "Monday",
                "4:00 to 5:15",
                new[] { "1A", "2A", "4A" },
                new List<ClassMonth>
                {
                    new("September", "8, 15, 22, 29"),
                    new("October", "6, 20, 27"),
                    new("November", "3, 17"),
                    new("December", "1, 15"),
                    new("January", "5, 12, 26"),
                    new("February", "2, 9, 23"),
                    new("March", "2, 9, 30"),
                    new("April", "13, 20, 27"),
                    new("May", "4")
                }
            ),
            new(
                "Monday",
                "5:30 to 6:45",
                new[] { "1B", "2B", "SS1", "6A" },
                new List<ClassMonth>
                {
                    new("February", "2, 9, 23"),
                    new("March", "2, 9, 30"),
                    new("April", "13, 20, 27"),
                    new("May", "4")
                }
            ),
            new(
                "Tuesday",
                "4:00 to 5:15",
                new[] { "1C", "2C", "3A" },
                new List<ClassMonth>
                {
                    new("September", "9, 16, 23, 30"),
                    new("October", "7, 21, 28"),
                    new("November", "4, 18"),
                    new("December", "2, 16"),
                    new("January", "6, 13, 27"),
                    new("February", "3, 10, 24"),
                    new("March", "3, 10, 31"),
                    new("April", "14, 21, 28"),
                    new("May", "5")
                }
            ),
            new(
                "Wednesday",
                "4:00 to 5:15",
                new[] { "1D", "2D", "5A" },
                new List<ClassMonth>
                {
                    new("September", "10, 17, 24"),
                    new("October", "1, 8, 22, 29"),
                    new("November", "5, 19"),
                    new("December", "3, 17"),
                    new("January", "7, 14, 28"),
                    new("February", "4, 11, 25"),
                    new("March", "4, 11"),
                    new("April", "1, 15, 22, 29"),
                    new("May", "6")
                }
            ),
            new(
                "Sunday",
                "12:00 to 2:30",
                new[] { "7A", "1st year confirmation", "2nd year confirmation" },
                new List<ClassMonth>
                {
                    new("September", "14, 28"),
                    new("October", "5, 26"),
                    new("November", "2, 16"),
                    new("December", "7, 14"),
                    new("January", "4, 11, 25"),
                    new("February", "1, 8, 22"),
                    new("March", "1, 8"),
                    new("April", "19, 26"),
                    new("May", "3")
                }
            )
        },
        new List<SpecialEvent>
        {
            new("First Holy Communion Practice", "Friday May 8th", "6:00 pm"),
            new("First Holy Communion", "Saturday May 9th", "10:00 am"),
            new("Confirmation Practice", "Friday May 29th 2026", "6:00 pm"),
            new("Confirmation", "May 31st 2026", "12:00 pm")
        }
    );
}

record ClassBlock(string Day, string Time, IReadOnlyList<string> Grades, IReadOnlyList<ClassMonth> Months);

record ClassMonth(string Month, string Dates);

record SpecialEvent(string Title, string Date, string Time);
