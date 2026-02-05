// @ts-nocheck
document.addEventListener('DOMContentLoaded', function() {
    const vscode = acquireVsCodeApi();
    
    let calendarEl = document.getElementById('calendar');
    let calendar;
    let currentEvents = []; 
    let selectedEventId = null;

    // Check if libraries are loaded
    if (typeof FullCalendar === 'undefined') {
        showError('FullCalendar library not loaded. Check your internet connection or CSP settings.');
        return;
    }
    if (typeof ICAL === 'undefined') {
        showError('ICAL.js library not loaded. Check your internet connection or CSP settings.');
        return;
    }

    try {
        // Initialize FullCalendar
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            height: '100%',
            editable: true,
            selectable: true,
            selectMirror: true,
            dayMaxEvents: true,
            locale: 'ja',
            buttonText: {
                prev: '‹',
                next: '›',
                today: '今日',
                month: '月',
                week: '週',
                day: '日',
                list: 'リスト'
            },
            
            eventClick: function(info) {
                openModal(info.event);
            },

            select: function(info) {
                openModal(null, info);
            },

            eventDrop: function(info) {
                updateDoc();
            },
            
            eventResize: function(info) {
                updateDoc();
            }
        });

        calendar.render();
    } catch (e) {
        showError('Failed to initialize calendar: ' + e.message);
        console.error(e);
    }

    // Global error handler
    window.onerror = function(msg, url, line, col, error) {
        showError(`JS Error: ${msg} at ${line}:${col}`);
        return false;
    };

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message from extension:', message.type);
        switch (message.type) {
            case 'update':
                const text = message.text;
                parseICal(text);
                break;
            case 'deleteConfirm':
                executeDeletion();
                break;
        }
    });

    // Request initial state
    console.log('Sending ready message to extension');
    vscode.postMessage({ type: 'ready' });

    function parseICal(content) {
        if (!content) return;
        
        try {
            // Pre-process: Add VALUE=DATE to DTSTART/DTEND if they are only 8 digits
            // Many weather iCal feeds omit this, but ICAL.js is strict.
            // e.g. DTSTART:20260205 -> DTSTART;VALUE=DATE:20260205
            // Also handle cases with other parameters or whitespace.
            console.log('Pre-processing iCal content...');
            content = content.replace(/^((?:DTSTART|DTEND)(?:;[^:]*)?):(\d{8})$/gm, '$1;VALUE=DATE:$2');

            console.log('Parsing iCal content length:', content.length);
            const jcalData = ICAL.parse(content);
            console.log('jCal Data:', JSON.stringify(jcalData).substring(0, 500) + '...');
            
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents('vevent');
            
            console.log('Found vevent components:', vevents.length);
            
            calendar.removeAllEvents();
            currentEvents = [];

            vevents.forEach((vevent, index) => {
                try {
                    // Use direct property access for more robustness
                    const dtstart = vevent.getFirstPropertyValue('dtstart');
                    const dtend = vevent.getFirstPropertyValue('dtend');
                    const summary = vevent.getFirstPropertyValue('summary') || '(No Title)';
                    const description = vevent.getFirstPropertyValue('description') || '';
                    const location = vevent.getFirstPropertyValue('location') || '';
                    const uid = vevent.getFirstPropertyValue('uid') || 'evt_' + Date.now() + '_' + index;

                    console.log(`Processing Event ${index}: summary="${summary}", start="${dtstart}"`);

                    if (!dtstart) {
                        console.warn(`Event ${index} has no start date, skipping.`);
                        return;
                    }

                    const fcEvent = {
                        id: uid,
                        title: summary,
                        start: dtstart ? dtstart.toJSDate() : null,
                        end: dtend ? dtend.toJSDate() : null,
                        allDay: dtstart.isDate,
                        editable: true,
                        extendedProps: {
                            description: description,
                            location: location
                        }
                    };

                    calendar.addEvent(fcEvent);
                } catch (eventErr) {
                    console.error(`Error parsing individual event ${index}:`, eventErr);
                    showError(`Event ${index} parsing failed: ${eventErr.message}`);
                }
            });
            
        } catch (error) {
            console.error('Error in parseICal:', error);
            showError('Global parse error: ' + error.message);
        }
    }

    function showError(message) {
        const errorEl = document.createElement('div');
        errorEl.style.color = 'red';
        errorEl.style.padding = '20px';
        errorEl.style.backgroundColor = '#ffeeee';
        errorEl.style.border = '1px solid red';
        errorEl.style.margin = '10px';
        errorEl.textContent = 'ERROR: ' + message;
        
        // Append to top of body or calendar container
        const container = document.querySelector('.app-container');
        if (container) {
            container.insertBefore(errorEl, container.firstChild);
        } else {
            document.body.appendChild(errorEl);
        }
    }

    // Modal & Editing
    const modal = document.getElementById('eventModal');
    const closeBtn = document.querySelector('.close');
    const cancelBtn = document.querySelector('.cancel-btn');
    const deleteBtn = document.getElementById('deleteEventBtn');
    const eventForm = document.getElementById('eventForm');
    
    const titleInput = document.getElementById('eventTitle');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const locInput = document.getElementById('eventLocation');
    const descInput = document.getElementById('eventDescription');
    const allDayCheckbox = document.getElementById('allDayCheckbox');
    const modalTitle = document.getElementById('modalTitle');

    function openModal(event, selectionInfo) {
        modal.classList.add('show');
        document.body.classList.add('modal-active');
        
        if (event) {
            selectedEventId = event.id;

            modalTitle.textContent = 'イベント編集';
            deleteBtn.style.display = 'block';
            
            // Ensure inputs are enabled
            const inputs = [titleInput, startInput, endInput, locInput, descInput];
            inputs.forEach(input => input.disabled = false);
            const submitBtn = document.querySelector('#eventForm .submit-btn');
            if (submitBtn) {
                submitBtn.style.display = 'inline-block';
            }

            titleInput.value = event.title;
            // Handle All Day
            allDayCheckbox.checked = event.allDay;
            toggleDateInputs(event.allDay);

            if (event.allDay) {
                // For all-day events, FullCalendar might give us a date without time
                // We just need the YYYY-MM-DD part
                startInput.value = toISODateString(event.start);
                // FullCalendar end date for all-day is exclusive (next day), user expects inclusive or same day
                // But for the input, let's just show the raw date for now or subtract 1 day if we want inclusive logic
                // Usually for UI ranges, people expect "Start: X, End: X" for a 1-day event.
                // FullCalendar: Start 2026-02-06, End 2026-02-07 (1 day)
                
                let endDate = event.end;
                if (!endDate && event.start) {
                    endDate = new Date(event.start); // If no end, assume 1 day
                    endDate.setDate(endDate.getDate() + 1);
                }
                
                // transform back to inclusive for UI? 
                // Let's stick to standard behavior: if editing, we show what's there.
                // But HTML date input is just a date.
                // Let's use a helper to get YYYY-MM-DD
                
                // Correction: For one-day events, `end` might be null or next day.
                // If we want inclusive end date in UI:
                const exclusiveEnd = event.end ? event.end : new Date(event.start.getTime() + 86400000);
                const inclusiveEnd = new Date(exclusiveEnd.getTime() - 86400000);
                
                endInput.value = toISODateString(inclusiveEnd);

            } else {
                startInput.value = toLocalISOString(event.start);
                endInput.value = event.end ? toLocalISOString(event.end) : toLocalISOString(event.start);
            }

            locInput.value = event.extendedProps.location || '';
            descInput.value = event.extendedProps.description || '';
        } else if (selectionInfo) {
            selectedEventId = null;
            modalTitle.textContent = '新規イベント';
            deleteBtn.style.display = 'none';
            
            // Ensure inputs are enabled for new events
            const inputs = [titleInput, startInput, endInput, locInput, descInput];
            inputs.forEach(input => input.disabled = false);
            document.querySelector('#eventForm .submit-btn').style.display = 'inline-block';

            titleInput.value = '';
            let start = selectionInfo.start;
            let end = selectionInfo.end;
            let isAllDay = selectionInfo.allDay;

            allDayCheckbox.checked = isAllDay;
            toggleDateInputs(isAllDay);
            
            if (isAllDay) {
                startInput.value = toISODateString(start);
                // selectionInfo.end is exclusive
                const inclusiveEnd = new Date(end.getTime() - 86400000);
                endInput.value = toISODateString(inclusiveEnd);
            } else {
                startInput.value = toLocalISOString(start);
                endInput.value = toLocalISOString(end);
            }
            
            locInput.value = '';
            descInput.value = '';
        }
    }

    function closeModal() {
        modal.classList.remove('show');
        document.body.classList.remove('modal-active');
        eventForm.reset();
        selectedEventId = null;
    }

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    window.onclick = function(event) {
        if (event.target == modal) {
            closeModal();
        }
    }

    allDayCheckbox.onchange = function() {
        toggleDateInputs(this.checked);
    };

    function toggleDateInputs(isAllDay) {
        if (isAllDay) {
            startInput.type = 'date';
            endInput.type = 'date';
            // Slice to keep just the date part if it was datetime
            if (startInput.value.includes('T')) startInput.value = startInput.value.split('T')[0];
            if (endInput.value.includes('T')) endInput.value = endInput.value.split('T')[0];
        } else {
            startInput.type = 'datetime-local';
            endInput.type = 'datetime-local';
            // Append time if missing
            if (startInput.value && !startInput.value.includes('T')) startInput.value += 'T09:00';
            if (endInput.value && !endInput.value.includes('T')) endInput.value += 'T10:00';
        }
    }

    eventForm.onsubmit = function(e) {
        e.preventDefault();
        
        const eventData = {
            title: titleInput.value,
            // start/end construction depends on allDay
            extendedProps: {
                location: locInput.value,
                description: descInput.value
            },
            allDay: allDayCheckbox.checked
        };

        if (eventData.allDay) {
            // Treat input values as just dates. 
            // FullCalendar expects:
            // allDay: true
            // start: "YYYY-MM-DD"
            // end: "YYYY-MM-DD" (exclusive)
            
            const startDateStr = startInput.value; // YYYY-MM-DD
            let endDateStr = endInput.value; // YYYY-MM-DD
            
            // For logic, let's create Date objects. 
            // Warning: new Date("YYYY-MM-DD") is usually UTC. new Date("YYYY-MM-DDT00:00") is local.
            // We want to be careful not to introduce timezone shifts that change the day.
            // It's safest to just pass the string to FullCalendar if possible, OR keep everything local.
            
            // Let's stick to parsing them carefully.
            eventData.start = new Date(startDateStr + 'T00:00:00');
            
            // For end date: User entered inclusive end date. FC needs exclusive.
            // So we take the user's end date, add 1 day, and use that.
            const userEndDate = new Date(endDateStr + 'T00:00:00');
            if (!isNaN(userEndDate.getTime())) {
                userEndDate.setDate(userEndDate.getDate() + 1);
                eventData.end = userEndDate;
            } else {
                 eventData.end = null;
            }
            
        } else {
            eventData.start = new Date(startInput.value);
            eventData.end = new Date(endInput.value);
        }

        if (selectedEventId) {
            const event = calendar.getEventById(selectedEventId);
            if (event) {
                event.setProp('title', eventData.title);
                event.setExtendedProp('location', eventData.extendedProps.location);
                event.setExtendedProp('description', eventData.extendedProps.description);
                event.setAllDay(eventData.allDay);
                event.setStart(eventData.start);
                event.setEnd(eventData.end);
            }
        } else {
            calendar.addEvent({
                id: 'evt_' + Date.now(),
                title: eventData.title,
                start: eventData.start,
                end: eventData.end,
                allDay: eventData.allDay,
                extendedProps: eventData.extendedProps
            });
        }
        
        updateDoc();
        closeModal();
    };

    deleteBtn.onclick = function() {
        if (selectedEventId) {
            vscode.postMessage({ type: 'deleteRequest' });
        }
    };

    function executeDeletion() {
        if (selectedEventId) {
            const event = calendar.getEventById(selectedEventId);
            if (event) {
                event.remove();
            }
            updateDoc();
            closeModal();
        }
    }

    function updateDoc() {
        const events = calendar.getEvents();
        
        // Rebuild ICS
        const comp = new ICAL.Component(['vcalendar', [], []]);
        comp.updatePropertyWithValue('prodid', '-//iCalendar Editor//JP');
        comp.updatePropertyWithValue('version', '2.0');
        
        events.forEach(fcEvent => {
            const vevent = new ICAL.Component('vevent');
            const event = new ICAL.Event(vevent);
            
            event.uid = fcEvent.id;
            event.summary = fcEvent.title;
            event.description = fcEvent.extendedProps.description || '';
            event.location = fcEvent.extendedProps.location || '';
            
            // For all-day events, use local components (useUTC=false) to ensure the date matches what the user entered.
            // For timed events, use UTC (useUTC=true) to preserve absolute time.
            // Actually, for events without timezone (floating), we might want local too, but let's stick to existing pattern for timed events.
            const useUTC = !fcEvent.allDay;
            
            const start = ICAL.Time.fromJSDate(fcEvent.start, useUTC);
            if (fcEvent.allDay) {
                start.isDate = true;
            }
            event.startDate = start;
            
            if (fcEvent.end) {
                const end = ICAL.Time.fromJSDate(fcEvent.end, useUTC);
                if (fcEvent.allDay) {
                    end.isDate = true;
                }
                event.endDate = end;
            }

            comp.addSubcomponent(vevent);
        });

        const iCalString = comp.toString();
        
        // Send to extension
        vscode.postMessage({
            type: 'update',
            text: iCalString
        });
    }

    function toLocalISOString(date) {
        if (!date) return '';
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date - offset)).toISOString().slice(0, 16);
        return localISOTime;
    }

    function toISODateString(date) {
        if (!date) return '';
        // If it's already a date-only string (from FC internal)
        // But FC usually gives Date objects.
        // We want YYYY-MM-DD in local time.
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date - offset);
        return localDate.toISOString().slice(0, 10);
    }

    function isSameDay(d1, d2) {
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }
});
