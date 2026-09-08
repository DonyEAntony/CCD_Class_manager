window.initRegistrationSteps = ({ form, syncRequired, requiredFields, childIndex, familyAvailable }) => {
  const es = document.documentElement.lang === 'es';
  const text = (en, spanish) => es ? spanish : en;
  const family = document.getElementById('parent-section');
  const children = document.getElementById('children-container');
  const documents = document.getElementById('documents-section');
  if (!family || !children || !documents) return;
  documents.classList.add('col-12');
  children.after(documents); // Move existing controls; retain values and FileLists.
  const review = document.createElement('section');
  review.className = 'col-12';
  documents.after(review);
  const sections = [family, children, documents, review];
  if (!document.getElementById('wizard-progress')) {
    const progress = document.createElement('div'); progress.id = 'wizard-progress'; progress.className = 'mb-3';
    const label = document.createElement('p'); label.id = 'wizard-progress-label'; label.className = 'fw-semibold mb-1';
    const fraction = document.createElement('p'); fraction.id = 'wizard-progress-fraction'; fraction.className = 'small text-muted';
    progress.append(label, fraction); form.before(progress);
  }
  const names = es ? ['Familia', 'Niños', 'Documentos', 'Revisión'] : ['Family', 'Children', 'Documents', 'Review'];
  let step = familyAvailable ? 0 : 1;
  const submitRow = document.getElementById('submit-row');
  const submit = document.getElementById('submit-btn');
  const controls = document.createElement('div');
  controls.className = 'col-12 d-flex gap-2 align-items-center';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'btn btn-outline-secondary'; back.textContent = text('Back', 'Atrás');
  const next = document.createElement('button'); next.type = 'button'; next.className = 'btn btn-primary';
  controls.append(back, next); submitRow.before(controls);
  ['continue-to-student', 'back-to-parent'].forEach(id => document.getElementById(id)?.remove());
  const notice = document.createElement('p'); notice.className = 'small text-muted';
  notice.textContent = text('Back keeps your entries and selected files on this page. Information is saved when you submit or save and continue to the next child.', 'Atrás conserva los datos y archivos seleccionados en esta página. Los datos se guardan al enviar o guardar y continuar al siguiente niño.');
  form.before(notice);
  documents.querySelectorAll('.certificate-upload').forEach((wrap, index) => {
    const hint = document.createElement('p'); hint.className = 'form-text'; hint.id = 'document-help-' + index;
    hint.textContent = text('Upload a readable PDF or image of the certificate named above so the office can verify the sacrament. Existing uploaded files are listed below. Contact the office if the certificate is unavailable.', 'Suba un PDF o imagen legible del certificado indicado para que la oficina verifique el sacramento. Los archivos existentes aparecen abajo. Contacte a la oficina si no tiene el certificado.');
    wrap.after(hint);
    wrap.querySelectorAll('input').forEach(input => input.setAttribute('aria-describedby', hint.id));
  });
  form.querySelectorAll('.form-label').forEach(label => {
    const field = label.parentElement.querySelector('input,select,textarea');
    if (!field || field.type === 'file' || label.classList.contains('required') || requiredFields.includes(field)) return;
    const optional = document.createElement('span'); optional.className = 'small text-muted'; optional.textContent = text(' (optional)', ' (opcional)'); label.append(optional);
  });
  const validate = section => {
    syncRequired();
    const invalid = [...section.querySelectorAll('input,select,textarea')].find(field => !field.closest('.d-none') && !field.checkValidity());
    if (invalid) { invalid.reportValidity(); return false; }
    return true;
  };
  const buildReview = () => {
    review.replaceChildren();
    const heading = document.createElement('h2'); heading.className = 'h5'; heading.textContent = text('Review before saving', 'Revise antes de guardar'); review.append(heading);
    const note = document.createElement('p'); note.textContent = text('Review this child’s information and the fee notice below. For multiple children, Save and continue saves this child before opening the next one.', 'Revise los datos de este niño y las tarifas indicadas abajo. Para varios niños, Guardar y continuar guarda este niño antes de abrir el siguiente.'); review.append(note);
    sections.slice(0,3).forEach((section, index) => {
      if (index === 0 && !familyAvailable) return;
      const title = document.createElement('h3'); title.className = 'h6 mt-3'; title.textContent = names[index];
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-link btn-sm'; edit.textContent = text('Edit', 'Editar'); edit.addEventListener('click', () => show(index)); title.append(edit); review.append(title);
      const list = document.createElement('dl');
      section.querySelectorAll('input,select,textarea').forEach(field => {
        if (!field.name || field.type === 'hidden' || field.disabled || field.closest('.d-none')) return;
        // The label is always a direct sibling of its field inside the same wrapper
        // element, regardless of which grid/column class that wrapper happens to use —
        // walking up to the nearest ancestor that has a form-label was missing wrapper
        // classes (.col-md-3/.col-md-9 among others) and could pick up an unrelated
        // field's label instead.
        const label = field.parentElement?.querySelector(':scope > .form-label');
        const term = document.createElement('dt'); term.textContent = label?.textContent || field.name.replaceAll('_',' ');
        const value = document.createElement('dd');
        value.textContent = field.type === 'file' ? ([...field.files].map(f => f.name).join(', ') || text('No new file selected; existing files are retained.', 'Sin archivo nuevo; se conservan archivos existentes.')) : field.type === 'checkbox' ? (field.checked ? text('Yes','Sí') : 'No') : field.tagName === 'SELECT' ? (field.selectedOptions[0]?.textContent || '—') : (field.value || '—');
        list.append(term,value);
      });
      review.append(list);
    });
  };
  const show = index => {
    // Build the summary while each section is visible, retaining conditional hiding.
    sections.slice(0,3).forEach((section,i) => section.classList.toggle('d-none', i === 0 && !familyAvailable));
    if(index === 3) buildReview();
    step = index;
    sections.forEach((section,i) => section.classList.toggle('d-none', i !== step));
    submitRow.classList.toggle('d-none', step !== 3);
    back.hidden = step === (familyAvailable ? 0 : 1);
    next.hidden = step === 3; next.textContent = text('Continue to ', 'Continuar a ') + names[step+1];
    const progress = document.getElementById('wizard-progress');
    if(progress) { progress.classList.remove('d-none'); progress.setAttribute('aria-live','polite'); }
    const label = document.getElementById('wizard-progress-label');
    if(label) label.textContent = names.join(' → ');
    const fraction = document.getElementById('wizard-progress-fraction');
    if(fraction) fraction.textContent = text('Step ', 'Paso ') + (step+1) + text(' of 4', ' de 4') + ' · ' + names[step] + (childIndex > 1 ? text(' · Child ', ' · Niño ') + childIndex : '');
    syncRequired();
  };
  const advance = () => {
    const count = document.getElementById('child-count-select');
    if(step === 0 && count && !count.checkValidity()) { count.reportValidity(); return; }
    if(validate(sections[step])) show(step+1);
  };
  next.addEventListener('click', advance);
  back.addEventListener('click', () => show(step-1));
  const previousChild = children.querySelector('a[href*="stage=student"]');
  if (previousChild) {
    previousChild.textContent = text('Save and return to previous child', 'Guardar y volver al niño anterior');
    previousChild.addEventListener('click', event => {
      event.preventDefault();
      let direction = form.querySelector('[name="wizard_direction"]');
      if (!direction) { direction = document.createElement('input'); direction.type = 'hidden'; direction.name = 'wizard_direction'; form.append(direction); }
      direction.value = 'previous';
      // Going back to fix an earlier child shouldn't require THIS child's own sections
      // to be complete first — that's the whole point of being able to step back. The
      // capturing submit listener below skips its full-section validation for this
      // direction; the server still enforces its own minimum (name/gender/DOB) before
      // saving the row.
      form.requestSubmit(submit);
    });
  }
  form.addEventListener('submit', event => {
    const direction = form.querySelector('[name="wizard_direction"]');
    if (direction && direction.value === 'previous') return;
    if(step !== 3) { event.preventDefault(); event.stopImmediatePropagation(); advance(); return; }
    for(let index=familyAvailable?0:1;index<3;index++) {
      show(index);
      if(!validate(sections[index])) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    }
    show(3);
  }, true);
  show(step);
};
